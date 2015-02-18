var crypt = require('crypto-lite').crypto;
var bitCoder = require('bit-coder');
var timers = require('timers');
var setTimeout = timers.setTimeout;
var clearTimeout = timers.clearTimeout;

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
 *                      time, give up on a FIND_NODE search primitive and
 *                      return whatever we've got so far.
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
    id: null,
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

  this.bitId = this._hex2BitStream(this.id);
  

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

  // We need to keep a list of active searches, so that the callbacks and
  // timeouts can accumulate a return value there.
  // Also, to coordinate them, they'll have to have a serial number.
  this.findNodeSearchSerial = 0;
  this.findNodeSearches = {};
}

module.exports = exports = KademliaDHT;

KademliaDHT.prototype._hex2BitStream = function (hex) {
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

KademliaDHT.prototype._bitStream2Hex = function (buf) {
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

KademliaDHT.prototype._bitCmp = function (b1, b2) {
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

KademliaDHT.prototype._xor = function (b1, b2) {
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
  if (this._bitCmp(key, bucketMax) == 0) {
    return null;
  }

  bucketMax.index = 0;
  bucketMax.writeBits(1,1);
  for (var i=this.B; i>0; i--) {
    bucketMax.index = this.B - i;
    var cmp = this._bitCmp(key, bucketMax);
    if (this._bitCmp(key, bucketMax) <= 0) {
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
  var distance = this._xor(key, this.bitId);
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

  if (typeof prune != "undefined" && prune) {
    this._pruneBucket(bucketIndex);
  }
};

/**
 * Prune a bucket.  Make sure it has at most the best this.k entries.
 */
KademliaDHT.prototype._pruneBucket = function (bucketIndex) {
  var keys = Object.keys(this.buckets[bucketIndex]);
  var nmemb = keys.length;
  if (nmemb > this.k) {
    for (var i=nmemb; i>this.k; i--) {
      var pruneIndex = this._chooseNodeToPrune(this.buckets[bucketIndex]);
      var pruneKey = keys[pruneIndex];
      keys[pruneIndex] = keys[i-1];

      this.buckets[bucketIndex][pruneKey].close();
      delete this.buckets[bucketIndex][pruneKey];
    }
  }
};

/**
 * Choose a node to prune out of the bucket.
 * In standard kademlia, we would use some sort of "last contacted" metric to
 * determine who was not a good node.
 * I'm not sure we need that here, because with WebRTC, all our connections are
 * guaranteed to be up and to have sent us keepalive packets (I think).  So we
 * have nothing to recommend one node over another here.  Unless we come up
 * with some other statistic, like RTT maybe.
 * For now, just pick random ones to prune (if pruning is indeed needed).
 */
KademliaDHT.prototype._chooseNodeToPrune = function (bucket) {
  var keys = Object.keys(bucket);
  var pruneIndex = Math.floor(Math.random() * keys.length);
  return pruneIndex;
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
 */
KademliaDHT.prototype.recvFindNodePrimitive = function (findKey, requestorKey, offers, returnCallback) {
  var numReturn = 0;
  var returnBucket = {};
  var visited = new Array(this.k);
  
  var searchId = this.findNodeSearchSerial++;
  this.findNodeSearches[searchId] = {
    offers: offers,
    numOffers: offers.length,
    timeout: setTimeout(KademliaDHT.prototype._returnFindNodeSearch.bind(this, searchId, returnCallback), this.findNodeTimeout),
    answers: [],
  };

  // Find the nearest bucket.  For each node that's a member of that bucket,
  // transmit an offer to them and register a callback that will add their
  // answer to the return value of the search.
  var bitFindKey = this._hex2BitStream(findKey);
  var bucketIndex = this._findBucketIndex(bitFindKey);
  var bucket = this.buckets[bucketIndex];
  var bucketKeys = Object.keys(bucket);
  for (var i=0; i<this.k && i < bucketKeys.length && this.findNodeSearches[searchId].offers.length > 0; i++) {
    // XXX We have to make sure that the requestor never gets contacted in this
    // search to respond to its own request.
    var key = bucketKeys[i];
    var remoteNode = bucket[key];
    if (remoteNode.id != requestorKey) { 
      var offer = this.findNodeSearches[searchId].offers.pop();
      remoteNode.recvOffer(offer, this._recvAnswer.bind(this, searchId, returnCallback));
    }
  }

  // If we did not actually send any offers, we can return immediately.
  // This would happen if we know of no peers.
  if (this.findNodeSearches[searchId].offers.length == this.findNodeSearches[searchId].numOffers) {
    this._returnFindNodeSearch(searchId, returnCallback);
  }

  // XXX If we did not fill the bucket, look at "nearby buckets".  The kademlia
  // spec does not say how to find these nearby buckets.
};

/**
 * Receive an answer from a remote node.  Put it in the accumulating return
 * value.  If the return bucket is full, return it via the callback.
 */
KademliaDHT.prototype._recvAnswer = function (searchId, returnCallback, answer) {
  this.findNodeSearches[searchId].answers.push(answer);

  // Figure out how many offers we sent.  If this answer is the last, we can
  // return immediately.
  var sentOffers = this.findNodeSearches[searchId].numOffers - this.findNodeSearches[searchId].offers.length;

  // And how many answers do we have now?
  var recvdAnswers = this.findNodeSearches[searchId].answers.length;

  if (recvdAnswers >= this.k || recvdAnswers >= sentOffers) {
    this._returnFindNodeSearch(searchId, returnCallback);
  }
};

/**
 * Send the accumulated return value back to the caller.
 */
KademliaDHT.prototype._returnFindNodeSearch = function (searchId, returnCallback) {
  clearTimeout(this.findNodeSearches[searchId].timeout);
  returnCallback(this.findNodeSearches[searchId].answers);
  delete this.findNodeSearches[searchId];
};


/**
 * A single Kademlia peer node.
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
}

KademliaRemoteNode.prototype.close = function () {
  // We aren't really networked yet.  When we are, we will call:
  // this.peer.close();
};

KademliaRemoteNode.prototype.recvOffer = function (offer, recvAnswerCallback) {
  // XXX Get the offer that a remote node send.  Create an answer and send it back.
};

module.exports = exports = {KademliaDHT: KademliaDHT, KademliaRemoteNode: KademliaRemoteNode};
