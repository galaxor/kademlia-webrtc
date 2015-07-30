var crypt = require('crypto-lite').crypto;
var bitCoder = require('bit-coder');

var WebRTCPeer = require('WebRTCPeer');

var timers = require('timers');
var setTimeout = timers.setTimeout;
var clearTimeout = timers.clearTimeout;

// We want a now() function that works in real life, but also can be mocked for
// testing.  I don't know if the mock() function can replace the built-in
// Date.now function, so I'll just stick time-mock's now function in timers.
var now = (typeof timers.now == "function")? timers.now : Date.now;

/**
 * Create a distributed hash table using the Kademlia protocol as specified here:
 *    http://xlattice.sourceforge.net/components/protocol/kademlia/specs.html
 *
 * @param options An object with some of these keys.  If a default exists, it is listed here.
 *    alpha - integer (default: 3): The amount of concurrent RPCs allowed.
 *            (we actually use "loose parallelism" - we send the next iteration
 *            of the RPC algorithm after a timeout has passed, rather than
 *            waiting for all the RPCs to return)
 *    B - integer (default: 256): The number of bits in the keys used to
 *        identify nodes and values.  For these keys, we use SHA256 hashes, hence 256 bits.
 *    k - integer (default: 20):  The maximum number of contacts stored in a bucket.
 *    tExpire - integer in seconds (default: 86410 [~one day]): The time after the
 *              original publication date after which a key/value pair expires.
 *    tRepublish - integer in seconds (default: 86400 [1 day]): After this
 *                 time, the original publisher must republish a key/value pair.
 *    tRefresh - integer in seconds (default: 3600 [1hr]): If a bucket has not
 *               been accessed in this amount of time, refresh it.
 *    tReplicate - integer in seconds (default: 3600 [1hr]): After this amount
 *                 of time, a node must publish its entire database.
 *    --
 *    The parameters above are from the spec.  The ones below are
 *    implementation details not in the spec.
 *    findNodeTimeout - integer in msec (default: 500): After this amount of
 *                      time, Bob will give up on a FIND_NODE search primitive and
 *                      return whatever we've got so far.
 *    foundNodeTimeout - integer in msec (default: 600): After this amount of
 *                      time, Alice will give up on hearing a FOUND_NODE and return
 *                      an empty set.
 *    channelOpenTimeout - integer in msec (default: 500): After this amount of
 *                      time, Alice will give up on the Craigs opening a
 *                      channel, and return what we have managed to open so far.
 */
function KademliaDHT(options) {
  var characteristics = {
    alpha: 3,
    B: 256,
    k: 20,
    tExpire: 86410,
    tRepublish: 86400,
    tRefresh: 3600,
    tReplicate: 3600,
    findNodeTimeout: 500,
    foundNodeTimeout: 600,
    channelOpenTimeout: 500,
    id: null,
    unexpectedMsg: 'ignore',
  };

  // Set the defaults.
  for (k in characteristics) {
    this[k] = characteristics[k];
  }

  if (typeof options == 'string') {
    this.id = options;
  } else {
    // Allow the defaults to be overridden.
    for (k in characteristics) {
      if (typeof options[k] != "undefined") {
        this[k] = options[k];
      }
    }
  }

  if (this.id.length * 4 != this.B) {
    throw new Error("The id length for the node ("+(this.id.length*4)+") is not the same as the id length for the network ("+this.B+").");
  }

  this.bitId = bitOps.hex2BitStream(this.id);
  
  // The keys will be the hex representation of the remote node's kademlia IDs.
  // The values will be KademliaRemoteNode objects.
  // These peers will also reside in the buckets, but this is a way of
  // accessing them quickly when their id is known.
  this.knownPeers = {};

  // Initialize the buckets.
  this.buckets = new Array(this.B);
  for (var i=0; i<this.buckets.length; i++) {
    // this.buckets[i] will eventually have a maximum of this.k entries.
    // We will not preallocate that as an array, though.  Instead, we will make it an object.
    // The keys will be the hex representation of the network id.
    this.buckets[i] = {};
  }

  // The value store
  this.values = {};

  // We need to keep a list of active searches that we are processing as Bob,
  // so that the callbacks and timeouts can accumulate a return value there.
  // Also, to coordinate them, they'll have to have a serial number.
  this.findNodeSearchSerial = 0;
  this.findNodeSearches = {};

  // When a message isn't something that can be interpreted by the individual
  // KademliaRemoteNodes, it'll bubble up to here.
  // This is a great place to extend the KademliaDHT's abilities -- by calling
  // KademliaDHT.addListener().
  // The format of this object is:
  // {'MSG_NAME': <array or object>}
  // If it's an array, then it is an array of callbacks that will respond no
  // matter who the message is from.
  // If it's an object, it's an object with the format: {from_addr: <array of callbacks>}
  // In that case, the message will be passed to the callbacks only if it is
  // from the peer whose id is from_addr.
  this.listeners = {};

  // This tells us things about searches where we've gotten a FOUND_NODE but we
  // still have to wait for communication to open.
  // We identify the searches with the searchSerial.
  // Each search we're waiting for has this structure:
  // searchResolution[searchSerial] = {
  //  awaitingReply: #, // The number of peers we still haven't heard from.
  //  repliedPeers: {key: kademliaRemoteNode, ...}, // The peers who have replied.
  //  timeout: timeOut, // When this timeout expires, give up on the rest of
  //                    // the ones we're waiting for and return what we've got.
  // }
  this.searchResolution = {};

  // We also keep track of peers we're waiting to hear from.  We keep track of
  // them by key.  We keep track of which searches are waiting for them.
  // It could be that two concurrent searches both attempt to initate
  // communication with the same Craig, not knowing it's the same person.  In
  // that case, a response from either should resolve both searches.
  // Each pendingResponsePeer has this structure:
  //   pendingResponsePeer[key] = {serial#: true, serial#: true, serial#: true}
  // Each of those serial#s refers to a search.
  // If a search gives up, it's going to have to remove itself from the list of
  // searches that the peer will resolve.  If all the searches give up, that
  // peer is no longer pending.
  this.pendingResponsePeers = {};

  // If we receive an unexpected message, the default behavior is to ignore it.
  // If the KadmeliaDHT is initialized with unexpectedMsg: 'ignore', it will
  // ignore these messages.  If it is set to 'log', then the message will be
  // stored in this array.  If it is set to 'throw', then an exception will be
  // thrown.
  this.unexpectedMsgLog = [];
}

/**
 * Handle an Unexpected message.
 * The default behavior is to ignore it.
 * The debugging behavior is to log it to an array or throw an exception.
 */
KademliaDHT.prototype.handleUnexpected = function (msg, data) {
  switch (this.unexpectedMsg) {
  case 'throw':
    throw new UnexpectedError(msg);
    break;

  case 'log':
    this.unexpectedMsgLog.push({msg: msg, data: data});
    break;

  case 'ignore':
  default:
    break;
  }
};


/**
 * Add a listener for a particular message.
 * @param string op The callback will be fired only if the message has this op.
 * @param string from The callback will be fired only if it was sent from the
 *   peer with this id.  If 'from' is null, the callback will be fired if the op
 *   is correct, no matter who the sender is.
 * @param function callback This is the callback that will be fired when we
 *   receive a matching message.  The signature is callback(msg).  If the
 *   callback returns a true value, no other callbacks will be processed for this
 *   message.
 */
KademliaDHT.prototype.addListener = function (op, from, callback) {
  if (from == null) {
    if (typeof this.listeners[op] == "undefined") {
      this.listeners[op] = [];
    }
    this.listeners[op].push(callback);
  } else {
    if (typeof this.listeners[op] == "undefined") {
      this.listeners[op] = {};
    }
    if (typeof this.listeners[op][from] == "undefined") {
      this.listeners[op][from] = [];
    }
    this.listeners[op][from].push(callback);
  }
};

/**
 * If a KademliaRemoteNode received a message it didn't know how to deal with,
 * it will pass the message up to here.
 * @param string from The hex representation of the kademlia ID of the peer that sent the message.
 * @param object msg The message that was sent to us.
 */
KademliaDHT.prototype.onMessage = function (from, msg) {
  if (typeof msg != "object" && typeof msg.op != "string") {
    throw new MalformedError("Malformed");
  }

  var op = msg.op;

  var listeners = null;
  if (this.listeners[op] instanceof Array) {
    listeners = this.listeners[op];
  } else if (typeof this.listeners[op] == "object") {
    listeners = this.listeners[op][from];
  }

  if (listeners == null) {
    this.handleUnexpected("Unexpected message.");
  }

  var stop = false;
  for (var i=0; i<listeners.length && !stop; i++) {
    stop = listeners[i](msg);
  }
};

/**
 * Return the index of the first bit that is nonzero.
 * Where the least significant bit is given the index 0.
 */
KademliaDHT.prototype._findNonzeroBitIndex = function (key) {
  var keyindex = key.index;
  var bucketMax = new bitCoder.BitStream(this.B);
  bucketMax.fillBits(0, this.B);

  // A special check for if it's zero.  If we don't have this, the logic below
  // will try to write past the end of the bit array.
  if (bitOps.bitCmp(key, bucketMax) == 0) {
    return null;
  }

  bucketMax.index = 0;
  bucketMax.writeBits(1,1);
  for (var i=this.B; i>0; i--) {
    bucketMax.index = this.B - i;
    var cmp = bitOps.bitCmp(key, bucketMax);
    if (bitOps.bitCmp(key, bucketMax) <= 0) {
      return i-1;
    }

    // Move the bit over for the next run.
    bucketMax.index = this.B - i;
    bucketMax.writeBits(1, 2);
  }
  return null;
};

/**
 * Find the index of the bucket that the key should go into.
 * @param key The BitStream key that we want to find a bucket for.
 */
KademliaDHT.prototype._findBucketIndex = function (key) {
  var distance = bitOps.xor(key, this.bitId);
  return this._findNonzeroBitIndex(distance);
};

/**
 * Insert a node into the appropriate bucket.
 * At this point, a node is an object:
 * {id: <a node id, a string in hex>,
 *  bitId: <the same node id, as a BitStream>,
 *  peer: <A WebRTCPeer, which should have an open data channel>,
 *  some statistics???
 * }
 * If prune is set, and is set to a true value, then we will prune the bucket
 * we inserted into, making sure that it contains only the this.k best nodes.
 */
KademliaDHT.prototype._insertNode = function (node, prune) {
  var bucketIndex = this._findBucketIndex(node.bitId);
  this.buckets[bucketIndex][node.id] = node;
  this.knownPeers[node.id] = node;

  if (typeof prune != "undefined" && prune) {
    this._pruneBucket(bucketIndex);
  }

  node.dht = this;
};

/**
 * Prune a bucket.  Make sure it has at most the best this.k entries.
 */
KademliaDHT.prototype._pruneBucket = function (bucketIndex) {
  var keys = Object.keys(this.buckets[bucketIndex]);
  var nmemb = keys.length;
  if (nmemb > this.k) {
    for (var i=nmemb; i>this.k; i--) {
      var pruneKey = this._chooseNodeToPrune(this.buckets[bucketIndex]);

      this.buckets[bucketIndex][pruneKey].close();
      // XXX These things should maybe happen as a callback after the close() function.
      delete this.buckets[bucketIndex][pruneKey];
      delete this.knownPeers[pruneKey];
    }
  }
};

/**
 * Choose a node to prune out of the bucket.
 * Choose the least-recently-seen node in the bucket.
 */
KademliaDHT.prototype._chooseNodeToPrune = function (bucket) {
  var keys = Object.keys(bucket);

  var leastRecentlySeenIndex = null;
  var leastRecentlySeenTime = null;
  var pruneKey = null;

  // A node won't ever get put into the buckets and knownPeers until we've
  // heard something from it, so we don't have to worry about any of the
  // lastSeens being null.
  for (var i=0; i<keys.length; i++) {
    var lastSeenTime = this.knownPeers[keys[i]].lastSeen;
    if (leastRecentlySeenTime == null || leastRecentlySeenTime > lastSeenTime) {
      leastRecentlySeenTime = lastSeenTime;
      leastRecentlySeenIndex = i;
    }
  }

  pruneKey = keys[leastRecentlySeenIndex];
  
  return pruneKey;
};

/**
 * Remove a node from the DHT.
 */
KademliaDHT.prototype._removeNode = function (key) {
  delete this.knownPeers[key];
  var bitId = bitOps.hex2BitStream(key);
  var bucketIndex = this._findBucketIndex(bitId);
  delete this.buckets[bucketIndex][key];
};

/**
 * The following functions are called by a callback function from one of the
 * WebRTCPeer objects that this KademliaDHT owns.  (The KademliaDHT will own
 * one WebRTCPeer object for each connection it has with a remote peer).
 * Basically, the WebRTCPeer object watches the data channels for incoming RPC
 * requests and then dispatches them to the KademliaDHT.
 */

/**
 * Receive a FIND_NODE primitive request.  Set up a callback to pass the
 * results to the caller.  The caller will be a KademliaRemoteNode object --
 * the one that made the request.
 * Here, we are acting as Bob.
 * We've been passed a key to find, a number of offers from the remote node,
 * and a callback to call once the return value is ready.
 * We will search our buckets to come up with the k best matches.  For each of
 * those matches, we will pass it one of the offers that the caller gave us.
 * If we get an answer, we will put it on the list of responses to give back to
 * the caller.  If we don't get an answer, don't bother refilling the bucket.
 * But before we start the search, we will set up a hard deadline.  Once that
 * deadline passes, we give up the search and just send whatever we have.
 * To keep track of this all, we need the KademliaDHT object to keep a list of
 * active FIND_NODE searches so that we can assemble a response there.  We'll
 * need to come up with a serial number for each search, so that the timeout and
 * the callbacks know where to look for the accumulating return value.
 * The signature of the callback is returnCallback(answers).
 * Here, answers is the responses that each node gave us.
 * It has the structure [{
 *   key: craigId,
 *   idx: idx,
 *   answer: answer,
 * }, ...]
 * Each of the 'answer' members is something we should be able to feed into a
 * WebRTCPeer.recvAnswer().
 * @param function returnCallback This is a call to a KademliaRemoteNodeBob.sendFoundNode(fromKey, searchKey, searchSerial, answers).  But when it was passed to us, the first three args were curried, so all we still need to pass is answers.  In other words, this is what we will call once all the answers have come back and we've assembled them for the original requestor.
 */
KademliaDHT.prototype.recvFindNodePrimitive = function (findKey, requestorKey, searchSerial, offers, returnCallback) {
  var numReturn = 0;
  var returnBucket = {};
  var visited = new Array(this.k);
  
  var searchId = this.findNodeSearchSerial++;
  this.findNodeSearches[searchId] = {
    offers: offers,
    searchKey: findKey,
    requestorKey: requestorKey,
    serial: searchSerial,
    numOffers: offers.length,
    timeout: setTimeout(KademliaDHT.prototype._returnFindNodeSearch.bind(this, searchId, returnCallback, false), this.findNodeTimeout),
    answers: [],
  };

  // Find the nearest bucket.  For each node that's a member of that bucket,
  // transmit an offer to them and register a callback that will add their
  // answer to the return value of the search.
  var bitFindKey = bitOps.hex2BitStream(findKey);

  var nodesTouched=0;
  var bucketIndex = this._findBucketIndex(bitFindKey);

  // If they've requested the key of this node, don't return self, just return
  // the most-specific bucket.
  if (bucketIndex == null) {
    bucketIndex = this.buckets.length - 1;
  }
  var targetBucket = bucketIndex;

  // Move from the target bucket to the most-specific bucket.  If we're still
  // not full, start from the target bucket -1 and move toward the
  // least-specific bucket.
  do {
    var bucket = this.buckets[bucketIndex];
    var bucketKeys = Object.keys(bucket);
    for (var i=0; nodesTouched<this.k && i < bucketKeys.length && this.findNodeSearches[searchId].offers.length > 0; i++) {
      var key = bucketKeys[i];
      var remoteNode = bucket[key];
      if (remoteNode.id != requestorKey) { 
        var idx = this.findNodeSearches[searchId].offers.length-1;
        var offer = this.findNodeSearches[searchId].offers.pop();
        nodesTouched++;

        // Start listening for Craig to send ICECandidate messages to Alice.
        remoteNode.asBob.addIceListener(remoteNode.id, requestorKey);

        // Actually send the offer.
        remoteNode.asBob.sendOffer(findKey, offer, requestorKey, searchSerial, idx, this._recvAnswer.bind(this, searchId, returnCallback));
      }
    }

    // Move from the target bucket to the most-specific bucket.  If we're still
    // not full, start from the target bucket -1 and move toward the
    // least-specific bucket.
    if (bucketIndex >= targetBucket) {
      bucketIndex = bucketIndex + 1;
      if (bucketIndex == this.B) {
        bucketIndex = targetBucket - 1;
      }
    } else {
      bucketIndex = bucketIndex - 1;
    }
  } while (bucketIndex >= 0);

  // If we did not actually send any offers, we can return immediately.
  // This would happen if we know of no peers.
  if (this.findNodeSearches[searchId].offers.length == this.findNodeSearches[searchId].numOffers) {
    this._returnFindNodeSearch(searchId, returnCallback, true);
  }
};

/**
 * Receive an answer from a remote node.  Put it in the accumulating return
 * value.  If the return bucket is full, return it via the callback.
 * @param string searchId The hex representation of the key that was requested.
 * @param function returnCallback This is a call to a KademliaRemoteNode.asBob.sendFoundNode(fromKey, searchKey, searchSerial, answers).  But when it was passed to us, the first three args were curried, so all we still need to pass is answers.  In other words, this is what we will call once all the answers have come back and we've assembled them for the original requestor.
 * @param number idx
 * @param string craigId The hex representation of the id of the Craig that is sending this answer.
 * @param object answer An answer suitable for passing into WebRTCPeer.recvAnswer.
 */
KademliaDHT.prototype._recvAnswer = function (searchId, returnCallback, idx, craigId, answer) {
  if (typeof this.findNodeSearches[searchId] == "undefined") {
    this.handleUnexpected("Got an unexpected answer.", {searchId: searchId, idx: idx, craigId: craigId});
  }

  this.findNodeSearches[searchId].answers.push({
    key: craigId,
    idx: idx,
    answer: answer,
  });

  // Figure out how many offers we sent.  If this answer is the last, we can
  // return immediately.
  var sentOffers = this.findNodeSearches[searchId].numOffers - this.findNodeSearches[searchId].offers.length;

  // And how many answers do we have now?
  var recvdAnswers = this.findNodeSearches[searchId].answers.length;

  if (recvdAnswers >= this.k || recvdAnswers >= sentOffers) {
    this._returnFindNodeSearch(searchId, returnCallback, true);
  }
};

/**
 * Send the accumulated return value back to the caller.
 * The signature of the callback is returnCallback(answers).
 * Here, answers is the responses that each node gave us.  We should be able to
 * feed each one into a WebRTCPeer.recvAnswer().
 * @param string searchId The hex representation of the key that was being searched for.
 * @param function returnCallback This is a call to a KademliaRemoteNode.asBob.sendFoundNode(fromKey, searchKey, searchSerial, answers).  But when it was passed to us, the first three args were curried, so all we still need to pass is answers.  In other words, this is what we will call once all the answers have come back and we've assembled them for the original requestor.
 */
KademliaDHT.prototype._returnFindNodeSearch = function (searchId, returnCallback, cancelTimeout) {
  var findNodeSearch = this.findNodeSearches[searchId];
  var searchSerial = findNodeSearch.serial;

  // Don't clear the timeout.  What if _returnFindNodeSearch was called
  // *by* the timeout?  Clearing the timeout after the timeout has been called
  // has been shown to cause problems with time-mock.
  if (cancelTimeout) {
    clearTimeout(findNodeSearch.timeout);
  }

  // Clear answer listeners.  (DON'T clear the ICECandidate listeners because
  // Alice will not start sending ICECandidates until after receiving the
  // FOUND_NODE message.  If we stop forwarding now, they will never communicate.
  var aliceKey = findNodeSearch.requestorKey;
  for (var i=0; i<findNodeSearch.answers.length; i++) {
    var craigKey = findNodeSearch.answers[i].key;

    delete this.knownPeers[craigKey].listeners['answer'][aliceKey][searchSerial];
    if (Object.keys(this.knownPeers[craigKey].listeners['answer'][aliceKey]).length == 0) {
      delete this.knownPeers[craigKey].listeners['answer'][aliceKey];
    }

    /*
    delete this.knownPeers[craigKey].listeners['ICECandidate'][craigKey][aliceKey];
    if (Object.keys(this.knownPeers[craigKey].listeners['ICECandidate'][craigKey]).length == 0) {
      delete this.knownPeers[craigKey].listeners['ICECandidate'][craigKey];
    }

    delete this.knownPeers[aliceKey].listeners['ICECandidate'][aliceKey][craigKey];
    if (Object.keys(this.knownPeers[aliceKey].listeners['ICECandidate'][aliceKey]).length == 0) {
      delete this.knownPeers[aliceKey].listeners['ICECandidate'][aliceKey];
    }
    */
  }

  returnCallback(findNodeSearch.answers);

  delete this.findNodeSearches[searchId];
};

/**
 * A single Kademlia peer node.
 * The args object should contain at least:
 * id: The hex representation of the id of the remote node.
 * peer: a WebRTCPeer that can be used to communicate with the remote node.
 */
function KademliaRemoteNode(args) {
  var defaults = {
    // In contacting the remote side, give up after this many ms.
    timeout: 1000,
  };

  // Set the defaults.
  for (k in defaults) {
    this[k] = defaults[k];
  }

  // Override defaults with args.
  var keys = Object.keys(args);
  for (var i=0; i<keys.length; i++) {
    this[keys[i]] = args[keys[i]];
  }

  // When we receive network communication, we will see if we expect a message
  // matching its signature.  If so, we will fire the callback.
  this.listeners = {
    'FOUND_NODE': {},
    'answer': {},
    'ICECandidate': {},
  };

  // Keep track of when the node was last seen.  This will be updated whenever
  // we get a message of any kind from the node.  It will be used by
  // KademliaDHT._chooseNodeToPrune when it's time to prune a bucket:  We will
  // prune the least-recently used.
  this.lastSeen = null;

  // We will set up timeouts for ICE Candidate listeners.  If the channel
  // doesn't open during that time, we will remove the listener.  If the
  // channel does open, we can cancel the timeout by finding it here in this
  // object.
  this.iceTimeouts = {};
  this.iceTimeout = 10000;

  this.bitId = bitOps.hex2BitStream(this.id);

  // These help us logically separate behavior so that we understand who the
  // KademliaRemoteNode is acting as when running a particular function.
  // Imagine the situation in which Alice sends a FIND_NODE to Bob.  Bob sends
  // Alice's offer to Craig.  Craig sends Bob an answer.  Bob sends all the
  // Craigs's answers back to Alice.
  this.asAlice = new KademliaRemoteNodeAlice(this);
  this.asBob = new KademliaRemoteNodeBob(this);
  this.asCraig = new KademliaRemoteNodeCraig(this);
}

KademliaRemoteNodeAlice = function (node) {
  this.node = node;

  // Keep track of the FIND_NODE searches that we've initiated, so that when we
  // get ICE candidates and answers, we'll know what search they come from.
  this.findNodeSearchesInitiatedSerial = 0;
  this.findNodeSearchesInitiated = {};
};
KademliaRemoteNodeBob = function (node) { this.node = node; };
KademliaRemoteNodeCraig = function (node) {
  this.node = node; 

  // If we've gotten an offer from someone, we create a WebRTCPeer and create
  // an answer and wait for the channel to open.  If we don't hear back in this
  // many msec, we can give up on hearing from them.
  this.pendingPeerTimeout = 5000;

  // If we've gotten an offer from someone, we create a WebRTCPeer and create
  // an answer and wait for the channel to open.  While we wait, we need to
  // keep this WebRTCPeer somewhere so it doesn't get garbage collected.  Also,
  // we can set a timeout and give up on hearing from them if they don't
  // respond in time.
  // Therefore, the structure of this is: {<key>: {peer:<peer>, timeout:<timeout ID>}, ...}
  // We save the timeout id so that we can remove it if the channel does open in time.
  this.pendingPeers = {};
};

KademliaRemoteNode.prototype.close = function () {
  this.peer.close();
};

/**
 * Send an offer to the remote side, as part of a FIND_NODE search.
 * The offer was created by Alice.  We are acting as Bob.  We will send this offer to Craig.
 * The message we will send to Craig is like this:
 * {"op":"offer", "from":<hex representation of Alice's id>, "offer":<offer>, "serial":<serial from Alice>, "idx":<a number>}
 * @param object offer The offer that was created by Alice.
 * @param string aliceKey The hex representation of Alice's id.
 * @param integer idx When alice initially created the offers, she also sent this search serial to help identify it.
 * @param integer idx When alice initially created an array of offers, this was the position in that array of the offer we are about to send.
 * @param function recvAnswerCallback This is a call to KademliaRemoteNode._recvAnswer.bind(this, searchId, returnCallback));
 */
KademliaRemoteNodeBob.prototype.sendOffer = function (findKey, offer, aliceKey, searchSerial, idx, recvAnswerCallback) {
  // We will send this offer.  We expect to get back, from Craig, at a later
  // date, a message like this:
  // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "serial":<serial from Alice>, "idx":<idx>}
  // We must be prepared to assemble those answers and send them back to Alice
  // (using the recvAnswerCallback) the assembled return value, once we've
  // received all of the answers or when we've reached the timeout.

  if (typeof this.node.listeners['answer'][aliceKey] == "undefined") {
    this.node.listeners['answer'][aliceKey] = {};
  }
  this.node.listeners['answer'][aliceKey][searchSerial] = recvAnswerCallback;

  this.node.peer.send('dht', {
    op: 'offer',
    from: aliceKey,
    offer: offer,
    serial: searchSerial,
    idx: idx,
  });
};


/**
 * Create a bucket full of offers.
 * Here, we are acting as Alice and we will send these offers to Bob.
 * @param function callback Call this callback once the offers are created, with the signature callback(offers, peers).  This is an anonymous function created in KademliaRemoteNode.prototype.Alice.sendFindNodePrimitive.
 */
KademliaRemoteNodeAlice.prototype._makeOffers = function (callback) {
  var retOffers = [];
  var retPeers = [];

  // We need to stick the new WebRTCPeers somewhere so they don't disappear at
  // the end of each for loop iteration.
  // However, I want to return the offers and the peers in arrays so that the
  // ith offer was made by the ith peer.
  // So we're going to end up making two arrays of peers:  One unsorted, one sorted.
  // The sorted one will get returned to the callback.  The unsorted one will
  // fall out of scope and die.
  var unsortedPeers = [];

  for (var i=0; i<this.node.dht.k; i++) {
    var k = this.node.dht.k;

    var peer = new WebRTCPeer({
      sendOffer: function (peer, offer) {
        retOffers.push(offer);
        retPeers.push(peer);

        if (retOffers.length >= k) {
          callback(retOffers, retPeers);
        }
      },

      // sendLocalIce: We will set this to a function that sends the ICE
      //   candidate to Craig (through Bob).  We have to wait until we know 
      //   Craig's Kademlia ID before we can create this function.

      createDataChannels: {
        dht: {
          outOfOrderAllowed: false,
          maxRetransmitNum: 10,
          // onOpen: We will set this to a function that makes a
          //   KademliaRemoteNode from this WebRTCPeer and adds it to an
          //   accumulating set of KademliaRemoteNodes to return.
          //   We need to wait until we know Craig's key before
          //   we define this function.

          // onMessage: We will set up a function that looks at the
          //   KademliaRemoteNode.listeners property.  We will have to wait to
          //   create this function until we create the KademliaRemoteNode for
          //   this.

          // onClose: We will set this to a function that removes this
          //   KademliaRemoteNode from the KademliaDHT's list of known peers, and
          //   from the bucket.  We will wait until we have actually
          //   constructed a KademliaRemoteNode and added it to the DHT before
          //   we define this function.
        },
      },
    });
    unsortedPeers.push();
    peer.createOffer();
  }
};

/**
 * Add listeners for ICE Candidates from Craig to Alice.
 * Since Alice will be getting ICE candidates before she knows the kademlia IDs
 * of the Craigs sending them, they will be addressed by (searchSerial, idx).
 * Also, the address includes Alice's kademlia ID so that we know this
 * ICECandidate is addressed to us (so we will respond as Alice) rather than
 * being addressed to someone else (in which case we will respond as Bob, by
 * forwarding it).  Therefore, the full address of the listener is 
 * (aliceKey, searchSerial, idx).
 */
KademliaRemoteNodeAlice.prototype.addIceListener = function (searchSerial, fromIdx, peer) {
  if (typeof this.node.listeners['ICECandidate'][this.node.dht.id] == "undefined") {
    this.node.listeners['ICECandidate'][this.node.dht.id] = {};
  }
  if (typeof this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial] == "undefined") {
    this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial] = {};
  }
  this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial][fromIdx] = this.recvIceCandidate.bind(this, searchSerial, fromIdx, peer);

  // Set up a timeout
  if (typeof this.node.iceTimeouts[this.node.dht.id] == "undefined") {
    this.node.iceTimeouts[this.node.dht.id] = {};
  }
  if (typeof this.node.iceTimeouts[this.node.dht.id][searchSerial] == "undefined") {
    this.node.iceTimeouts[this.node.dht.id][searchSerial] = {};
  }
  var cancelThisIce = this._cancelIceListener.bind(this, searchSerial, fromIdx);
  this.node.iceTimeouts[this.node.dht.id][searchSerial][fromIdx] = setTimeout(cancelThisIce, this.node.iceTimeout);
};

/**
 * Receive an ICE candidate from Craig.
 */
KademliaRemoteNodeAlice.prototype.recvIceCandidate = function (searchSerial, idx, peer, candidate) {
  peer.recvRemoteIceCandidate(candidate);
  
  // Refresh the timeout.  We've heard from them now, so don't give up on them
  // until they've gone silent for the full iceTimeout ms from now.
  clearTimeout(this.node.iceTimeouts[this.node.dht.id][searchSerial][idx]);
  var cancelThisIce = this._cancelIceListener.bind(this, searchSerial, idx);
  this.node.iceTimeouts[this.node.dht.id][searchSerial][idx] = setTimeout(cancelThisIce, this.node.iceTimeout);
};

/**
 * Cancel an ICECandidate listener if the channel failed to open after iceTimeout ms.
 */
KademliaRemoteNodeAlice.prototype._cancelIceListener = function (searchSerial, idx, clearTimeouts) {
  if (clearTimeouts) {
    clearTimeout(this.node.iceTimeouts[this.node.dht.id][searchSerial][idx]);
  }
  delete this.node.iceTimeouts[this.node.dht.id][searchSerial][idx];
  delete this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial][idx];
  if (Object.keys(this.node.iceTimeouts[this.node.dht.id][searchSerial]).length == 0) {
    delete this.node.iceTimeouts[this.node.dht.id][searchSerial];
    delete this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial];
    if (Object.keys(this.node.listeners['ICECandidate'][this.node.dht.id]).length == 0) {
      delete this.node.iceTimeouts[this.node.dht.id];
      delete this.node.listeners['ICECandidate'][this.node.dht.id];
    }
  }
};


/**
 * Add newly-found peers to our buckets.  Then call the user-specified callback.
 * @param callback function with signature callback({key:<hex key>, peer:<a WebRTCPeer object with communication open>, ...})
 * @param responsePeers {key:<hex key>, peer:<a WebRTCPeer object with communication open>, ...}
 */
KademliaRemoteNodeAlice.prototype.receivePeers = function (callback, responsePeers) {
  for (key in responsePeers) {
    var node = responsePeers[key];

    // Add the newcomers to the buckets.
    // XXX What if the bucket is full?  Are we sure we want to keep this node and
    // not another one?  If we were gonna not accept this node, perhaps we
    // shoulda informed Craig before we promised to talk to them.  For now, we
    // will punt this decision to the normal _insertNode mechanisms, which will
    // call _chooseNodeToPrune.
    this.node.dht._insertNode(node, true);

    // Set the onClose handler.
    var alice = this;
    node.peer.addDataChannelCloseHandler('dht', function (peer, channel) {
      alice.node.dht._removeNode(key);
    });
  }

  callback(responsePeers);
};


/**
 * Send a FIND_NODE primitive to the remote side.
 * Here, we are acting as Alice.  The remote side is acting as Bob.  The remote
 * side will unpack all the offers we sent and send them to individual nodes
 * (each acting as Craig).
 * Bob will collect the answers it gets in response and pass them back to us
 * when it's gotten them all.
 * @param string key The hex representation of the key we're looking for.
 * @param function returnCallback This will be called when everybody who's gonna answer has answered.  The signature is callback({key:<hex key>, peer:<a WebRTCPeer object with communication open>, ...})
 */
KademliaRemoteNodeAlice.prototype.sendFindNodePrimitive = function (key, returnCallback) {
  // Whatever the caller wants to do with these peers, let's make sure to
  // update our buckets.
  var callback = KademliaRemoteNodeAlice.prototype.receivePeers.bind(this, returnCallback);

  // When we get the answer back, it will be over the network.  What we need to
  // do is register a thing to listen for the appropriate message and when we
  // get it, call the callback.
  var node = this.node;

  // We need to keep track of our in-flight searches.  When we get ICE
  // candidates and answers, they will identify themselves by the search serial
  // and by their idx (which is explained below).
  // We could use the search key as the identifier for the search, but if we
  // use a search serial, we don't need to tell people what we're searching for
  // until we've decided to communicate with them directly.
  var searchSerial = this.findNodeSearchesInitiatedSerial;
  this.findNodeSearchesInitiated[this.findNodeSearchesInitiatedSerial] = {
    key: key,
    timeout: setTimeout((function (alice, serial, callback) {
      return function () {
        // Clear the info on this search.
        delete alice.node.listeners['FOUND_NODE'][serial];
        var idxes = Object.keys(alice.node.listeners['ICECandidate'][alice.node.dht.id][serial]);
        for (var i=0; i<idxes.length; i++) {
          alice._cancelIceListener(serial, idxes[i], true);
        }
        
        delete alice.findNodeSearchesInitiated[serial];

        // Call the callback with an empty return set.
        callback({});
      };
    })(this, this.findNodeSearchesInitiatedSerial, callback), this.node.dht.foundNodeTimeout),
  };
  this.findNodeSearchesInitiatedSerial++;

  node.asAlice._makeOffers(function (offers, peers) {
    node.listeners['FOUND_NODE'][searchSerial] = node.asAlice._recvFoundNode.bind(node.asAlice, key, searchSerial, peers, callback);

    // Craig may start sending ICE candidates before we know his kademlia ID,
    // because he will start sending ICE candidates as soon as he gets the
    // offer and creates an answer, whereas we will not know his kademlia ID
    // until we receive the FOUND_NODE, which we won't receive until all the
    // craigs have created answers.
    // What we'll do, then, is make Craig give the search serial number and idx
    // of the peer that the ICECandidate is about.  That way, we can
    // identify it by its position in the peers array, rather than by its kademlia ID.  
    // We will make node.listeners['ICECandidate'][aliceKey][searchSerial][idx] be the
    // listener we want.

    // So, register listeners for the ICE Candidates.
    for (var idx=0; idx < peers.length; idx++) {
      node.asAlice.addIceListener(searchSerial, idx, peers[idx]);
    }

    // Now actually send the FIND_NODE message.
    node.peer.send('dht', {
      op: 'FIND_NODE',
      key: key,
      serial: searchSerial,
      offers: offers,
    });
  });
};

/**
 * Handle a "FOUND_NODE" message.
 * Here, we are acting as Alice.  When we get a FOUND_NODE message (from Bob),
 * it will be like this:
 * {
 *  "op":"FOUND_NODE",
 *  "key":<hex representation of key that was originally requested>,
 *  "answers":[{"key":<hex rep of the first key>, "idx":<idx>, "answer":<answer>}, ...]
 * }
 * "idx" is the index from the original array, when we sent out the offers in
 * out FIND_NODE request.  Here, if "idx" is 0, that says that this answer
 * pertains to the first offer in the array.  We can use that to match up with
 * the WebRTCPeer we created.
 * @param string searchedKey The key that we were searching for, that this is in response to.
 * @param number searchSerial The serial number that Alice sent, to help identify searches.
 * @param array peers An array of WebRTCPeer objects.  We created these to make offers from.  In the FOUND_NODE message, each answer has an "idx".  That refers to the index of a peer in this array.
 * @param function callback Call this function once we've told each of the peers to recvAnswer.  The signature is callback({<hex key>:<a KademliaRemoteNode with communication open>, ...}).  The callback is whatever was passed in to KademliaRemoteNode.prototype.Alice.sendFindNodePrimitive.
 * @param array answers [{key:<craig's key>, idx:<idx>, answer:<answer obj>}, ...]
 */
KademliaRemoteNodeAlice.prototype._recvFoundNode = function (searchedKey, searchSerial, peers, callback, answers) {
  // An object that will gather the accumulating peers.
  // We keep track of how many peers we have yet to hear from.  When that
  // reaches zero, we can send the reply to the callback.
  // The reply will be the contents of searchResolution[searchSerial].repliedPeers.
  // Finally, we define a timeout, after which point we will give up on the
  // other peers and just return what we've got.
  this.node.dht.searchResolution[searchSerial] = {
    awaitingReply: 0,
    repliedPeers: {},
    timeout: setTimeout((function (callback, node) {
        return function () {
          delete node.listeners['FOUND_NODE'][searchSerial];

          var idxes = Object.keys(node.listeners['ICECandidate'][node.dht.id][searchSerial]);
          for (var i=0; i<idxes.length; i++) {
            node.asAlice._cancelIceListener(searchSerial, idxes[i], true);
          }

          clearTimeout(node.asAlice.findNodeSearchesInitiated[searchSerial].timeout);
          delete node.asAlice.findNodeSearchesInitiated[searchSerial];

          callback(node.dht.searchResolution[searchSerial].repliedPeers);

          // This search is now complete.
          delete node.dht.searchResolution[searchSerial];
        };
      })(callback, this.node), this.node.dht.channelOpenTimeout, this.node),
    callback: callback,
  };

  for (var i=0; i<answers.length; i++) {
    var key = answers[i].key;
    var idx = answers[i].idx;
    var answer = answers[i].answer;

    // If I know about this peer already, return the KademliaRemoteNode object
    // I already have for it.
    var knownPeer = this.node.dht.knownPeers[key];

    if (typeof knownPeer == "undefined") {
      // If this is a new peer, let's open communication to it.
      // We will need a sendLocalIce handler.  We can define that now that we
      // know the kademlia id of the remote node.
      var bob = this.node.peer;
      var dht = this.node.dht;

      // Apparently there is some sort of scope problem if I use the variable
      // "key" directly; when these callbacks are actually called, "key" will
      // be set to the last value it took, not the value it took when these
      // callbacks were created.
      var craigKey = key;

      // We must keep track of which outstanding searches care about this peer.
      // We do that with pendingResponsePeers.  If this peer responds to any of
      // the searches that are waiting for it, that will go toward resolving
      // all of the searches that are waiting for it.
      if (typeof this.node.dht.pendingResponsePeers[craigKey] == "undefined") {
        this.node.dht.pendingResponsePeers[craigKey] = {};
      }
      this.node.dht.pendingResponsePeers[craigKey][searchSerial] = idx;
      this.node.dht.searchResolution[searchSerial].awaitingReply++;

      var sendLocalIce = (function (coolKey) {
        var craigKey = coolKey;
        return function (peer, candidate) {
          bob.send('dht', {
            op: "ICECandidate",
            from: dht.id,
            to: craigKey,
            candidate: candidate,
          });
        };
      })(key);
      peers[idx].addSendLocalIceCandidateHandler(sendLocalIce);

      // We also need to define an onOpen function which adds this to the set
      // of nodes to return, once we've established communication.
      // Also, check all the searches that are waiting for this peer.  Add this
      // peer to the list of peers who have replied.  If this completes the set
      // of peers that search was waiting for, return the set.
      var onOpen = (function (craigKey, node) {
        return function (peer, channel) {
          var remoteNode = new KademliaRemoteNode({
            id: craigKey,
            peer: peer,
          });

          // This is a great time to add the onMessage callback!
          var onMessage = function (peer, channel, data) {
            remoteNode.onMessage(craigKey, data);
          };

          remoteNode.peer.addChannelMessageHandler('dht', onMessage);

          // Check all the searches that are waiting for this peer.  Add this
          // peer to the list of peers who have replied.  If this completes the set
          // of peers that search was waiting for, return the set.
          // var waitingSearches = Object.keys(node.dht.pendingResponsePeers[craigKey]);
          for (var serial in node.dht.pendingResponsePeers[craigKey]) {
            var idx = node.dht.pendingResponsePeers[craigKey][serial];
            node.dht.searchResolution[serial].repliedPeers[craigKey] = remoteNode;

            node.dht.searchResolution[serial].awaitingReply--;

            if (node.dht.searchResolution[serial].awaitingReply <= 0) {
              // All the peers have replied.  Return the full set.
              // Also, get rid of the timeout.
              clearTimeout(node.dht.searchResolution[serial].timeout);
              delete node.listeners['FOUND_NODE'][serial];
              delete node.listeners['ICECandidate'][node.dht.id][serial];
              if (Object.keys(node.listeners['ICECandidate'][node.dht.id]).length == 0) {
                delete node.listeners['ICECandidate'][node.dht.id];
              }
              clearTimeout(node.asAlice.findNodeSearchesInitiated[serial].timeout);
              delete node.asAlice.findNodeSearchesInitiated[serial];

              node.dht.searchResolution[serial].callback(node.dht.searchResolution[serial].repliedPeers);

              // This search is now complete.
              delete node.dht.searchResolution[serial];
            }
          }
          delete node.dht.pendingResponsePeers[craigKey];
        };
      })(craigKey, this.node);

      peers[idx].addDataChannelHandler('dht', onOpen);

      peers[idx].recvAnswer(answer);
    } else {
      // We already knew about this peer.  Just put the existing KademliaRemoteNode in the list.
      this.node.dht.searchResolution[searchSerial].repliedPeers[key] = this.node.dht.knownPeers[key];
      delete this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial][idx];
      if (Object.keys(this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial]).length == 0) {
        delete this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial];
        if (Object.keys(this.node.listeners['ICECandidate'][this.node.dht.id]).length == 0) {
          delete this.node.listeners['ICECandidate'][this.node.dht.id];
        }
      }
    }
  }

  // We will only reach this state if we knew about all the peers already.  If
  // there was anybody new to us, we will be waiting for their onOpen handlers
  // to fire.
  // If we had to wait for someone, then the callback will be called by their
  // onOpen callback, or by the timeout we set.
  // But if we knew about everybody already, we don't need to wait for
  // anything.  Just call the callback.
  if (this.node.dht.searchResolution[searchSerial].awaitingReply == 0) {
    // All the peers have replied.  Return the full set.
    // Also, get rid of the timeout.
    clearTimeout(this.node.dht.searchResolution[searchSerial].timeout);
    clearTimeout(this.findNodeSearchesInitiated[searchSerial].timeout);
    delete this.findNodeSearchesInitiated[searchSerial];

    delete this.node.listeners['FOUND_NODE'][searchSerial];
    delete this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial];
    if (Object.keys(this.node.listeners['ICECandidate'][this.node.dht.id]).length == 0) {
      delete this.node.listeners['ICECandidate'][this.node.dht.id];
    }

    this.node.dht.searchResolution[searchSerial].callback(this.node.dht.searchResolution[searchSerial].repliedPeers);

    // This search is now complete.
    delete this.node.dht.searchResolution[searchSerial];
  }
};


/**
 * Called when we get a message from the remote node.
 * This is a dispatching function.  We don't know if we will handle the message
 * as Alice, Bob, or Craig, until we read the message.
 * We will see if we've previously registered any listeners.  If we have, call them.
 * We will leave it up to the function we call to remove itself from the list, though.  Because maybe we wanted to receive multiple instances of that message.
 */
KademliaRemoteNode.prototype.onMessage = function (fromKey, data) {
  // Even if they send a malformed message, update lastSeen.  Mostly, just
  // because otherwise the code for updating lastSeen is spread throughout the
  // rest of this function and is more likely to be wrong, because for each
  // type of message, it takes us a few checks before we know if it's
  // well-formed.
  this.lastSeen = now();

  if (typeof data.op != "string") {
    throw new MalformedError("Malformed");
  }

  // I'm going to be explicit about which messages we accept and how to process them.
  switch (data.op) {
  case 'FIND_NODE':
    // If we've received a FIND_NODE message, we will act as Bob.  We must
    // contact a bunch of Craigs, assemble their answers, and send them back to
    // Alice.
    // We don't have to check if there's any active listeners for FIND_NODE; we
    // will always respond to anyone's FIND_NODE request.
    // A FIND_NODE looks like this:
    // {"op":"FIND_NODE", "key":<hex representation of key to search for>, "serial":<a serial number>, "offers":[k offers]}
    if (typeof data.key != "string" || typeof data.serial != "number" || !(data.offers instanceof Array)) {
      throw new MalformedError("Malformed");
    }

    // The returnCallback function should make a FOUND_NODE message and send it
    // across the wire.
    // That looks like this: {"op":"FOUND_NODE", "key":<hex representation of key that was originally requested>, "serial":<the original serial number Alice sent>, "answers":[{"key":<hex rep of Craig's key>, "idx":<idx>, "answer":<answer>}]}
    var returnCallback = this.asBob.sendFoundNode.bind(this.asBob, fromKey, data.key, data.serial);
    this.dht.recvFindNodePrimitive(data.key, fromKey, data.serial, data.offers, returnCallback);
    break;
  case 'FOUND_NODE':
    // If we've received a FOUND_NODE message, we are acting as Alice.  Bob has
    // assembled a bunch of nodes for us, and is returning them here.

    // That looks like this: {"op":"FOUND_NODE", "key":<hex representation of key that was originally requested>, "serial":<the original serial number>, "answers":[{"key":<hex rep of Craig's key>, "idx":<idx>, "answer":<answer>}]}

    if (typeof data.key != "string" || typeof data.serial != "number" || !(data.answers instanceof Array)) {
      throw new MalformedError("Malformed");
    }
    for (var i=0; i<data.answers.length; i++) {
      if (typeof data.answers[i] != "object" || typeof data.answers[i].key != "string" || typeof data.answers[i].idx != "number" || typeof data.answers[i].answer == "undefined") {
        throw new MalformedError("Malformed");
      }
    }

    if (typeof this.listeners['FOUND_NODE'][data.serial] == 'function') {
      this.listeners['FOUND_NODE'][data.serial](data.answers);
    } else {
      // Unexpected.
      this.dht.handleUnexpected("Received an unexpected FOUND_NODE", data);
    }
    break;

  case 'answer':
    // Here, we act as Bob.  A Craig has sent us an answer, like this:
    // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "serial":<serial>, "idx":<idx>}
    // We will accumulate these and send them on to Alice as a FOUND_NODE message.
    if (typeof data.to != "string" || typeof data.from != "string" 
        || typeof data.answer == "undefined" || typeof data.serial != "number"
        || typeof data.idx != "number") {
      throw new MalformedError("Malformed");
    }

    if (typeof this.listeners['answer'][data.to] == 'object' && typeof this.listeners['answer'][data.to][data.serial] == 'function') {
      // The function KademliaDHT.prototype._recvAnswer 
      // has this signature: function (searchId, returnCallback, idx, craigId, answer)
      // But it has been curried a couple times.  It already has these args set:
      // (searchId, returnCallback).  So all we need to send back is (idx, craigId, answer).
      this.listeners['answer'][data.to][data.serial](data.idx, data.from, data.answer);
    } else {
      // Unexpected.
      this.dht.handleUnexpected("Unexpected", data);
    }
    break;

  case 'offer':
    // Here, we act as Craig.  We've been sent an offer.  We make an answer and
    // send it back.
    // Bob sent us an offer like this:
    // {"op":"offer", "from":<hex representation of Alice's id>, "offer":<offer>, "searchKey":<hex rep of the key Alice is searching for>, "idx":<a number>}
    // Our goal is to send back an answer like this:
    // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "searchKey":<hex rep of the key Alice is searching for>, "idx":<idx>}
    // We will also add Alice to Craig's buckets.

    if (typeof data.from != "string" || typeof data.serial != "number" || typeof data.idx != "number" || typeof data.offer == "undefined") {
      throw new MalformedError("Malformed");
    }

    this.asCraig.recvOffer(data.from, data.offer, data.serial, data.idx, this.asCraig.sendAnswer.bind(this.asCraig, data.from, data.serial, data.idx));
    break;

  case 'ICECandidate':
    if (typeof data.from != "string" || typeof data.to != "string" || typeof data.candidate != "object") {
      throw new MalformedError("Malformed");
    }

    // Bob should have established listeners for Alice's ICE candidates when he
    // sent a FOUND_NODE, because that means Alice will soon receive the
    // answer, and Bob knows who Alice will be sending ICE Candidates to Craig.
    // Bob should have established listeners for Craig's ICE candidates when he
    // sent the offer to Craig.
    // Alice should have established listeners for Craig's ICE candidates when she
    // got the answer from Craig, because that is when she will know Craig's
    // kademlia ID.
    // Craig should have established listeners for Alice's ICE candidates when
    // he got the offer.

    // If I added listeners, whether as Alice, Bob, or Craig, they will all be
    // in the this.listeners['ICECandidate'] array.
    // But they each add them in a slightly different format, and the callback
    // has a slightly different signature.  I copy/pasted their code snippets
    // in here for reference on how to find them in the listeners array and how
    // to call them.

    // Alice format
    // this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial][fromIdx] = this.recvIceCandidate.bind(this, searchSerial, fromIdx, peer);

    // Bob format
    // this.node.listeners['ICECandidate'][fromKey][toKey] = this.forwardIceCandidate.bind(this, fromKey, toKey);

    // Craig format
    // this.node.listeners['ICECandidate'][aliceKey][this.node.dht.id] = this.recvIceCandidate.bind(this, aliceKey, alicePeer);

    // --

    if (data.to == this.dht.id) {
      // This is either Alice or Craig format.

      if (typeof data.serial == "number" && typeof data.idx == "number") {
        // This is Alice format.  Act as Alice.
        // Alice format
        // The listener was placed into the listeners array like so:
        // this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial][fromIdx] = this.recvIceCandidate.bind(this, searchSerial, fromIdx, peer);

        if (typeof this.listeners['ICECandidate'][this.dht.id] == "undefined"
            || typeof this.listeners['ICECandidate'][this.dht.id][data.serial] == "undefined"
            || typeof this.listeners['ICECandidate'][this.dht.id][data.serial][data.idx] == "undefined") {
          this.dht.handleUnexpected("Unexpected ICECandidate.", data);
          break;
        }

        this.listeners['ICECandidate'][this.dht.id][data.serial][data.idx](data.candidate);
      } else if (typeof data.serial == "undefined" && typeof data.idx == "undefined" && typeof data.candidate == "object") {
        if (typeof this.listeners['ICECandidate'][data.from] != "undefined"
          && this.listeners['ICECandidate'][data.from][this.dht.id] != "undefined") {
          // This is Craig format.  Act as Craig.
          // Craig format
          // The listener was placed into the listeners array like so:
          // this.node.listeners['ICECandidate'][aliceKey][this.node.dht.id] = this.recvIceCandidate.bind(this, aliceKey, alicePeer);

          // This is Craig format.  Act as Craig.
          this.listeners['ICECandidate'][data.from][this.dht.id](data.candidate);
        } else {
          this.dht.handleUnexpected("Unexpected ICECandidate.", data);
        }
      } else {
        // This is not Alice or Craig format.  It is malformed.
        throw new MalformedError("Malformed ICECandidate.");
      }
    }

    else {
      // This is Bob format.  Act as Bob.
      // Bob format
      // The listener was placed into the listeners array like so:
      // this.node.listeners['ICECandidate'][fromKey][toKey] = this.forwardIceCandidate.bind(this, fromKey, toKey);


      // It may have come from Alice or Craig.  If it came from Craig, it would look like this:
      // {"op":"ICECandidate", "from":<hex rep of Craig's key>, "to":<hex rep of Alice's key>, "candidate":<whatever the ICE candidate thing is>, "serial":<the serial number Alice sent>, "idx":<idx>}
      // If it came from Alice, it would look like this:
      // {"op":"ICECandidate", "from":<hex rep of Alice's key>, "to":<hex rep of Craig's key>, "candidate":<whatever the ICE candidate thing is>}
      if ((typeof data.serial != "number" && typeof data.serial != "undefined")
          || (typeof data.idx != "number" && typeof data.idx != "undefined")) {
        throw new MalformedError("Malformed ICECandidate");
      }

      if (typeof this.listeners['ICECandidate'][fromKey] != "undefined" 
          && typeof this.listeners['ICECandidate'][fromKey][data.to] != "undefined") {
        this.listeners['ICECandidate'][fromKey][data.to](data.candidate, data.serial, data.idx);
      } else {
        this.dht.handleUnexpected("Unexpected ICECandidate", data);
      }
    }
    
    break;

  default:
    // If we don't know what else to do, bubble the message up to the KademliaDHT.
    this.dht.onMessage(fromKey, data);
    break;
  }

  // I do not remove the listeners here, because what if this message did not
  // satisfy us?  I'm going to leave it up to the handlers to decide whether
  // we're satisfied.
  // But what about a bunch of stale listeners stinking up the place, if they
  // never get a response?
  // It will be the listeners' responsibility to set a timeout to give up and
  // remove those things.
};

KademliaRemoteNodeBob.prototype.addIceListener = function (fromKey, toKey) {
  if (typeof this.node.listeners['ICECandidate'][fromKey] == "undefined") {
    this.node.listeners['ICECandidate'][fromKey] = {};
  }

  this.node.listeners['ICECandidate'][fromKey][toKey] = this.forwardIceCandidate.bind(this, fromKey, toKey);
  // Set up a timeout
  if (typeof this.node.iceTimeouts[fromKey] == "undefined") {
    this.node.iceTimeouts[fromKey] = {};
  }
  this.node.iceTimeouts[fromKey][toKey] = setTimeout(this._cancelIceListener.bind(this, fromKey, toKey), this.node.iceTimeout);
};

/**
 * This function should make a FOUND_NODE message and send it across the wire.
 * Here, we are acting as Bob.  We have collected responses from various Craigs
 * and we will send them back to Alice.
 * The FOUND_NODE message looks like this:
 * {"op":"FOUND_NODE", "key":<hex representation of key that was originally requested>, "answers":[{"key":<hex rep of Craig's key>, "idx":<idx>, "answer":<answer>}, ...]}
 */
KademliaRemoteNodeBob.prototype.sendFoundNode = function (aliceKey, searchKey, searchSerial, answers) {
  var msg = {
    op: "FOUND_NODE",
    key: searchKey,
    serial: searchSerial,
    answers: answers,
  };

  // We can stop listening for answers from these peers.

  // We know who Alice will be sending ICE Candidates to, so we can set up a listener for it.
  for (var i=0; i<answers.length; i++) {
    var craigKey = answers[i].key;
    this.addIceListener(aliceKey, craigKey);
  }

  var recipient = this.node.dht.knownPeers[aliceKey];
  recipient.peer.send('dht', msg);
};

/**
 * Cancel an ICECandidate listener if the channel failed to open after iceTimeout ms.
 */
KademliaRemoteNodeBob.prototype._cancelIceListener = function (fromKey, toKey) {
  delete this.node.iceTimeouts[fromKey][toKey];
  delete this.node.listeners['ICECandidate'][fromKey][toKey];
  if (Object.keys(this.node.iceTimeouts[fromKey]).length == 0) {
    delete this.node.iceTimeouts[fromKey];
    delete this.node.listeners['ICECandidate'][fromKey];
  }
};

/**
 * Forward an ICE Candidate from Alice to Craig, or from Craig to Alice.
 * The format of the message is:
 * If it's from Alice to Craig:
 * {"op":"ICECandidate", "from":<hex rep of Alice's key>, "to":<hex rep of Craig's key>, "candidate":<whatever the ICE candidate thing is>}
 * If it's from Craig to Alice:
 * {"op":"ICECandidate", "from":<hex rep of Alice's key>, "to":<hex rep of Craig's key>, "idx":<idx>, "candidate":<whatever the ICE candidate thing is>}
 */
KademliaRemoteNodeBob.prototype.forwardIceCandidate = function (fromKey, toKey, candidate, serial, idx) {
  // Replace the fromKey with the known fromKey, so we know that nobody is
  // misrepresenting themselves.
  var msg = {
    op: 'ICECandidate',
    from: fromKey,
    to: toKey,
    candidate: candidate,
  }
  if (typeof serial != "undefined") {
    msg.serial = serial;
  }
  if (typeof idx != "undefined") {
    msg.idx = idx;
  }

  var recipient = this.node.dht.knownPeers[toKey];
  recipient.peer.send('dht', msg);
};


/**
 * Receive an offer and create an answer.
 * We will send this answer along to Bob to forward to Alice.  We expect that
 * Alice will open communication later.  When they do, we will add Alice to our
 * buckets.
 * @param string aliceKey The hex representation of Alice's key.
 * @param object offer An offer from Alice, suitable for passing to WebRTCPeer.recvOffer.
 * @param function sendAnswerCallback The callback is
 *   KademliaRemoteNodeCraig.prototype.sendAnswer(aliceKey, searchSerial, idx, answer), but the
 *   first three args have been curried, so we only need to send
 *   answer.  The answer should be an answer suitable for a WebRTCPeer.recvAnswer.
 */
KademliaRemoteNodeCraig.prototype.recvOffer = function (aliceKey, offer, searchSerial, idx, sendAnswerCallback) {
  var craig = this;
  var bob = this.node.peer;

  var peer = new WebRTCPeer({
    sendAnswer: function (peer, answer) {
      // We need to store this peer somewhere so it doesn't go away.  onOpen,
      // bring it out of there and put it in a bucket.
      // Also, we register a timeout after which we will give up on this pending peer.

      craig.pendingPeers[aliceKey] = {
        peer: peer,
        timeout: setTimeout(craig.abandonPendingPeer.bind(craig, aliceKey), craig.pendingPeerTimeout),
      };

      sendAnswerCallback(answer);
    },

    sendLocalIce: function (peer, iceCandidate) {
      // The message to Bob looks like this:
      // {"op":"ICECandidate", "from":<hex rep of Craig's key>, "to":<hex rep of Alice's key>, "candidate":<whatever the ICE candidate thing is>, "serial":<the serial number Alice sent>, "idx":<idx>}
      bob.send('dht', {
        op: 'ICECandidate',
        from: craig.node.dht.id,
        to: aliceKey,
        candidate: iceCandidate,
        serial: searchSerial,
        idx: idx,
      });
    },

    expectedDataChannels: {
      dht: {
        // onOpen: We will set this to a function that removes the WebRTCPeer
        //   from the pendingPeers, cancels the abandonment timeout, creates a
        //   KademliaRemoteNode, and adds it to the buckets.
        //   That function is:
        //   KademliaRemoteNodeCraig.onDataChannelOpen(aliceKey, peer, channel).
        onOpen: craig.onDataChannelOpen.bind(craig, aliceKey),

        // onMessage: We will set up a function that looks at the
        //   KademliaRemoteNode.listeners property.  We will have to wait to
        //   create this function until we create the KademliaRemoteNode for
        //   this.

        // onClose: We will set this to a function that removes this
        //   KademliaRemoteNode from the KademliaDHT's list of known peers, and
        //   from the bucket.  We will wait until we have actually
        //   constructed a KademliaRemoteNode and added it to the DHT before
        //   we define this function.
      },
    },
  });

  // Prepare to receive ICE Candidates.
  this.addIceListener(aliceKey, peer);

  peer.recvOffer(offer);
};

/**
 * Receive an ICE candidate from Alice.
 */
KademliaRemoteNodeCraig.prototype.addIceListener = function (aliceKey, alicePeer) {
  if (typeof this.node.listeners['ICECandidate'][aliceKey] == "undefined") {
    this.node.listeners['ICECandidate'][aliceKey] = {};
  }

  this.node.listeners['ICECandidate'][aliceKey][this.node.dht.id] = this.recvIceCandidate.bind(this, aliceKey, alicePeer);
  // Set up a timeout
  if (typeof this.node.iceTimeouts[aliceKey] == "undefined") {
    this.node.iceTimeouts[aliceKey] = {};
  }
  this.node.iceTimeouts[aliceKey][this.node.dht.id] = setTimeout(this._cancelIceListener.bind(this, aliceKey), this.node.iceTimeout);
};

/**
 * Receive an ICE candidate from Alice.
 */
KademliaRemoteNodeCraig.prototype.recvIceCandidate = function (aliceKey, alicePeer, candidate) {
  alicePeer.recvRemoteIceCandidate(candidate);
  
  // Refresh the timeout.  We've heard from them now, so don't give up on them
  // until they've gone silent for the full iceTimeout ms from now.
  clearTimeout(this.node.iceTimeouts[aliceKey][this.node.dht.id]);
  this.node.iceTimeouts[aliceKey][this.node.dht.id] = setTimeout(this._cancelIceListener.bind(this, aliceKey), this.node.iceTimeout);
};

/**
 * Cancel an ICECandidate listener if the channel failed to open after iceTimeout ms.
 */
KademliaRemoteNodeCraig.prototype._cancelIceListener = function (aliceKey, cancelTimeout) {
  if (cancelTimeout) {
    clearTimeout(this.node.iceTimeouts[aliceKey][this.node.dht.id]);
  }

  delete this.node.iceTimeouts[aliceKey][this.node.dht.id];
  delete this.node.listeners['ICECandidate'][aliceKey][this.node.dht.id];
  if (Object.keys(this.node.iceTimeouts[aliceKey]).length == 0) {
    delete this.node.iceTimeouts[aliceKey];
    delete this.node.listeners['ICECandidate'][aliceKey];
  }
};

/**
 * Send our answer to Bob to forward on to Alice.
 * {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "serial":<the serial number Alice sent>, "idx":<idx>}
 */
KademliaRemoteNodeCraig.prototype.sendAnswer = function (aliceKey, searchSerial, idx, answer) {
  var bob = this.node.peer;
  var craig = this.node.dht;

  bob.send('dht', {
    op: "answer",
    to: aliceKey,
    from: craig.id,
    idx: idx,
    serial: searchSerial,
    answer: answer,
  });
};

/**
 * Removes the WebRTCPeer from the pendingPeers, cancel the abandonment
 * timeout, cancel ICECandidate listeners, create a KademliaRemoteNode, and add
 * it to the buckets.
 */
KademliaRemoteNodeCraig.prototype.onDataChannelOpen = function (aliceKey, peer, channel) {
  debugger;
  clearTimeout(this.pendingPeers[aliceKey].timeout);
  delete this.pendingPeers[aliceKey];

  // Create a KademliaRemoteNode for the newcomer.
  var alice = new KademliaRemoteNode({
    id: aliceKey,
    peer: peer,
  });

  // Set the onMessage handler.
  var onMessage = function (peer, channel, data) {
    alice.onMessage(aliceKey, data);
  };

  peer.addChannelMessageHandler('dht', onMessage);

  // Cancel ICECandidate listener and timeout.
  this._cancelIceListener(aliceKey, true);

  // Add the newcomer to the buckets.
  // XXX What if the bucket is full?  Are we sure we want to keep this node and
  // not another one?  If we were gonna not accept this node, perhaps we
  // shoulda informed Alice before we promised to talk to them.  For now, we
  // will punt this decision to the normal _insertNode mechanisms, which will
  // call _chooseNodeToPrune.
  this.node.dht._insertNode(alice, true);

  // Set the onClose handler.
  var craig = this;
  peer.addDataChannelCloseHandler('dht', function (peer, channel) {
    craig.node.dht._removeNode(aliceKey);
  });

};

/**
 * We sent an answer and waited for Alice to open the channel.  That did not
 * happen after this.pendingPeerTimeout msec, so we will give up.
 */
KademliaRemoteNodeCraig.prototype.abandonPendingPeer = function (aliceKey) {
  this._cancelIceListener(aliceKey, true);
  delete this.pendingPeers[aliceKey];
};


/**
 * Custom exceptions.
 */
function MalformedError(message) {
  this.name = "MalformedError";
  this.message = message || "";
  this.stack = new Error().stack;
}
MalformedError.prototype = Object.create(Error.prototype);

function UnexpectedError(message) {
  this.name = "UnexpectedError";
  this.message = message || "";
  this.stack = new Error().stack;
}
UnexpectedError.prototype = Object.create(Error.prototype);


/**
 * Bit operations that we use.
 */
var bitOps = {};
bitOps.hex2BitStream = function (hex) {
  // If the number of bits is not a multiple of 32, I might have to pad the
  // data, and I don't feel like it.
  if (hex.length % 8) {
    throw new Error("The size of the hex is not a multiple of 32 bits.");
  }

  // Allocate a buffer.  1 hex char == 4 bits, so the size of the buffer is 4x
  // the length of the string.
  var buf = new bitCoder.BitStream(hex.length*4);
  buf.fillBits(0, hex.length*4);
  buf.index=0;

  // 32-bit chunks.
  for (var i=0; i<hex.length; i+=8) {
    var chunk = parseInt(hex.substr(i, 8), 16);
    buf.writeBits(chunk, 32);
  }

  buf.index = 0;
  return buf;
};

bitOps.bitStream2Hex = function (buf) {
  // If the number of bits is not a multiple of 32, I might have to pad the
  // data, and I don't feel like it.
  if (buf.view.length % 32 != 0) {
    throw new Error("The size of the bitstream is not a multiple of 32 bits.");
  }

  var hex = '';

  var bufIndex = buf.index;
  buf.index = 0;

  // 32-bit chunks.
  for (var i=0; i<buf.view.length; i+=32) {
    var chunk = buf.readBits(32) >>> 0;
    hex += chunk.toString(16);
  }

  buf.index = bufIndex;
  return hex;
};

bitOps.bitCmp = function (b1, b2) {
  // If we were asked to compare bitstreams of unequal length, we'd have to pad
  // the shorter one, and I don't feel like it.
  if (b1.length != b2.length) {
    throw new Error("The operands are not the same size.");
  }

  // Save the current indexes in the bitstreams.  Let's not change them.
  var i1 = b1.index;
  var i2 = b2.index;

  var retval = 0;
  for (b1.index=0, b2.index=0; b1.index < b1.view.length; ) {
    var chunk1 = b1.readBits(32) >>> 0;
    var chunk2 = b2.readBits(32) >>> 0;

    // Apparently, javascript has a '>>>' operator.  It's a zero-fill right
    // shift, as opposed to the sign-propogating right shift '>>'.
    // It works with unsigned numbers.  >>>'ing by 0 is a way to make
    // sure the numbers are treated as unsigned.
    // If these numbers are treated as signed, then 0x80000000 < 0x00000000,
    // whereas we want the answer to be 0x80000000 > 0x00000000.
    if ((chunk1>>>0) < (chunk2>>>0)) {
      retval = 1;
      break;
    } else if ((chunk1>>>0) > (chunk2>>>0)) {
      retval = -1;
      break;
    }
  }

  // Restore the indexes in the bitstreams.
  b1.index = i1;
  b2.index = i2;
  return retval;
};

bitOps.xor = function (b1, b2) {
  // If we were asked to xor bitstreams of unequal length, we'd have to pad
  // the shorter one, and I don't feel like it.
  if (b1.length != b2.length) {
    throw new Error("The operands are not the same size.");
  }

  // Save the current indexes in the bitstreams.  Let's not change them.
  var i1 = b1.index;
  var i2 = b2.index;

  var retval = new bitCoder.BitStream(b1.view.length);
  retval.fillBits(0, b1.length);
  retval.index = 0;

  for (b1.index=0, b2.index=0; b1.index < b1.view.length; ) {
    var chunk1 = b1.readBits(32);
    var chunk2 = b2.readBits(32);

    retval.writeBits(chunk1 ^ chunk2, 32);
  }
  retval.index = 0;

  // Restore the indexes in the bitstreams.
  b1.index = i1;
  b2.index = i2;
  return retval;
};

module.exports = exports = {KademliaDHT: KademliaDHT, KademliaRemoteNode: KademliaRemoteNode, KademliaRemoteNodeAlice: KademliaRemoteNodeAlice, KademliaRemoteNodeBob: KademliaRemoteNodeBob, KademliaRemoteNodeCraig: KademliaRemoteNodeCraig, bitOps: bitOps, MalformedError: MalformedError, UnexpectedError: UnexpectedError};
