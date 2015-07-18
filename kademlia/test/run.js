var assert = require('assert');
var mock = require('mock');
var mockTimer = require('time-mock');

function mockTimedKademlia(existingMockTime) {
  var mockTime;

  if (typeof existingMockTime == "undefined") {
    mockTime = mockTimer(0);
  } else {
    mockTime = existingMockTime;
  }

  var wrtc = mock('../wrtc-mock', {
      timers: {
        setTimeout: mockTime.setTimeout,
        clearTimeout: mockTime.clearTimeout,
      },
    },
    require
  );

  var WebRTCPeer = mock('WebRTCPeer', {
      wrtc: wrtc,
    },
    require
  );

  var kademlia = mock("../kademlia", {
      timers: {
        setTimeout: mockTime.setTimeout,
        clearTimeout: mockTime.clearTimeout,
        now: mockTime.now,
      },
      WebRTCPeer: WebRTCPeer,
    },
    require
  );

  kademlia.wrtc = wrtc;
  kademlia.WebRTCPeer = WebRTCPeer;

  kademlia.mockTime = mockTime;

  kademlia.makePair = makePair.bind(null, mockTime, WebRTCPeer);

  return kademlia;
}

function makePair(mockTime, WebRTCPeer) {
  var recvdMsg = null;

  var alice = new WebRTCPeer({
    name: 'alice',
    sendOffer: function (peer, offer) {
      bob.recvOffer(offer);
    },
    sendLocalIce: function (peer, iceCandidate) {
      bob.recvRemoteIceCandidate(iceCandidate);
    },
    createDataChannels: {
      dht: {},
    },
  });

  var bob = new WebRTCPeer({
    sendAnswer: function (peer, answer) {
      alice.recvAnswer(answer);
    },
    sendLocalIce: function (peer, iceCandidate) {
      alice.recvRemoteIceCandidate(iceCandidate);
    },
    expectedDataChannels: {
      dht: {},
    },
  });

  alice.createOffer();

  mockTime.advance(1);

  return {
    alice: alice,
    bob: bob,
    mockTime: mockTime,
  };
}

/**
 * Manually introduce two peers to each other.
 */
function matchMake(aliceDht, bobDht, kademlia) {
  // In the participants object, I have things called 'alice' and 'bob'.
  // What they mean is that alice has a connection to bob, so when alice
  // sends something, bob gets it.
  // Here, I have "bobAccordingToAlice".  This is an object belonging to
  // the person of alice.  When you instruct it to send something, bob
  // should get it.
  // Therefore, bobAccordingToAlice should have participants.alice, and
  // vice versa.
  // That is, when we say "according to", that is the person we are.  They
  // should possess the particpant named after them.
  var participants = kademlia.makePair();

  participants.bobAccordingToAlice = new kademlia.KademliaRemoteNode({id: bobDht.id, peer: participants.alice});
  participants.aliceAccordingToBob = new kademlia.KademliaRemoteNode({id: aliceDht.id, peer: participants.bob});

  aliceDht._insertNode(participants.bobAccordingToAlice);
  bobDht._insertNode(participants.aliceAccordingToBob);

  // These handlers would normally be added as part of the kademlia
  // process.  There will also be a process to add them when bootstrapping
  // the network.  For now, I am bootstrapping by hand.
  participants.bobAccordingToAlice.peer.addChannelMessageHandler('dht', function (peer, channel, data) {
    participants.bobAccordingToAlice.onMessage(bobDht.id, data);
  });
  participants.aliceAccordingToBob.peer.addChannelMessageHandler('dht', function (peer, channel, data) {
    participants.aliceAccordingToBob.onMessage(aliceDht.id, data);
  });

  // Now actually start communication.
  participants.alice.createOffer();
  kademlia.mockTime.advance(5);

  return participants;
}

describe("mock-wrtc", function () {
  it("can simulate basic webrtc data behavior", function () {
    // We instantiate kademlia because that'll give us WebRTCPeer and timers
    // all properly mocked.
    var kademlia = mockTimedKademlia();
    var participants = kademlia.makePair();

    var recvdMsg = null;
    participants.bob.addChannelMessageHandler('dht', function (peer, channel, data) {
      recvdMsg = data;
    });
    participants.alice.send('dht', 'hello');

    assert.equal(recvdMsg, 'hello');
  });
});

describe("KademliaDHT", function () {
  // XXX test the different forms of the constructor.
  describe("#constructor", function () {
    it("things should work when B > 32", function () {
      assert(0);
    });
  });

  // XXX test _insertNode.

  describe("#_pruneBucket", function () {
    it("should prune arbitrarily overfull buckets", function () {
      var kademlia = require("../kademlia");

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});
      var key1 = '80000001';

      // Insert nodes until the bucket is full.  Insert five more.
      for (var i=0; i<dht.k+5; i++) {
        var node = new kademlia.KademliaRemoteNode({id: key1, peer: null});

        // Add 1 to the key, so that the next key we create is 1 more.
        var key0 = (parseInt(key1, 16) + 1).toString(16);

        // Zero-pad the string.
        for (key1 = ''; key1.length < 8-key0.length; key1 += '0') { }
        key1 += key0;

        dht._insertNode(node);
      }

      // Prune the bucket.
      dht._pruneBucket(31);

      assert.equal(Object.keys(dht.buckets[31]).length, dht.k);
    });
  });

  describe("#recvFindNodePrimitive", function () {
    it("should immediately return an empty bucket if there are no peers.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      dht.recvFindNodePrimitive('80000001', '00000000', 0, ['fake offer'], callbackFn);

      assert.deepEqual(retVal, []);
    });

    it("should immediately return an empty bucket if there are no peers but the requestor.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var node = new kademlia.KademliaRemoteNode({id: key1, peer: null});
      // Replace the recvOffer function with one that will never call the return callback.
      node.recvOffer = function (offer, recvAnswerCallback) {
      };
      dht._insertNode(node);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      dht.recvFindNodePrimitive('80000001', '80000001', 0, ['fake offer'], callbackFn);

      assert.deepEqual(retVal, []);
    });

    it("should never contact the requesting node to fulfill its own request.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var callMeNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
      callMeNode.peer.send = function (chan, msg) {
        kademlia.mockTime.setTimeout(function () {
          // This is what we would have sent.
          // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
          if (chan == 'dht' && msg.op == 'offer') {
            // Instead of sending to anybody, just call your own onMessage.
            // This is what we will receive.
            // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "serial": <serial>, "answer":<answer>, "idx":<idx>}
            callMeNode.onMessage(key1, {op: 'answer', to: msg.from, from: key1, serial:msg.serial, answer:'good call', idx:msg.idx});
          }
        }, 10);
      };
      dht._insertNode(callMeNode);

      var key2 = '80000002';
      var dontCallNode = new kademlia.KademliaRemoteNode({id: key2, peer: {}});
      dontCallNode.peer.send = function (chan, msg) {
        kademlia.mockTime.setTimeout(function () {
          // This is what we would have sent.
          // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
          if (chan == 'dht' && msg.op == 'offer') {
            // Instead of sending to anybody, just call your own onMessage.
            // This is what we will receive.
            // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
            dontCallNode.onMessage(key2, {op: 'answer', to: msg.from, from: key2, answer:'bad call', idx:msg.idx});
          }
        }, 10);
      };
      dht._insertNode(dontCallNode);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      dht.recvFindNodePrimitive('80000001', '80000002', 0, ['fake offer', 'flake offer'], callbackFn);

      kademlia.mockTime.advance(20);

      assert.deepEqual(retVal, ['good call']);
    });

    it("should return an empty bucket if nobody responds in time.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var node = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
      // Replace the recvOffer function with one that will never call the return callback.
      node.peer.send = function (chan, msg) {
      };
      dht._insertNode(node);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      dht.recvFindNodePrimitive('80000001', '00000000', 0, ['fake offer'], callbackFn);

      // Let the time run out while we wait for answers.
      kademlia.mockTime.advance(600);
      
      assert.deepEqual(retVal, []);
    });

    it("should return only those nodes that responded in time.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
      willRespondNode.peer.send = function (chan, msg) {
        kademlia.mockTime.setTimeout(function () {
          // This is what we would have sent.
          // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
          if (chan == 'dht' && msg.op == 'offer') {
            // Instead of sending to anybody, just call your own onMessage.
            // This is what we will receive.
            // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
            willRespondNode.onMessage(key1, {op: 'answer', to: msg.from, from: key1, answer:'good call', serial:msg.serial, idx:msg.idx});
          }
        }, 10);
      };
      dht._insertNode(willRespondNode);

      var key2 = '80000002';
      var wontRespondNode = new kademlia.KademliaRemoteNode({id: key2, peer: {}});
      wontRespondNode.peer.send = function (chan, msg) {
      };
      dht._insertNode(wontRespondNode);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      dht.recvFindNodePrimitive('80000001', '00000000', 0, ['fake offer', 'flake offer'], callbackFn);

      kademlia.mockTime.advance(600);

      assert.deepEqual(retVal, ['good call']);
    });

    it("should return a partially-full bucket if there are not enough nodes to fill a bucket, and should return as soon as all nodes respond.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
      willRespondNode.peer.send = function (chan, msg) {
        kademlia.mockTime.setTimeout(function () {
          // This is what we would have sent.
          // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
          if (chan == 'dht' && msg.op == 'offer') {
            // Instead of sending to anybody, just call your own onMessage.
            // This is what we will receive.
            // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
            willRespondNode.onMessage(key1, {op: 'answer', to: msg.from, from: key1, answer:'good call', serial:msg.serial, idx:msg.idx});
          }
        }, 10);
      };
      dht._insertNode(willRespondNode);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      dht.recvFindNodePrimitive('80000001', '00000000', 0, ['fake offer', 'flake offer'], callbackFn);

      kademlia.mockTime.advance(20);

      assert.deepEqual(retVal, ['good call']);
    });

    it("should return a full bucket if there are enough nodes to fill a bucket.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4, unexpectedMsg: 'throw'});

      var keys = [
        '20000001',
        '20000002',
        '20000003',
        '20000004',
      ];
      for (var i=0; i<keys.length; i++) {
        var key1 = keys[i];
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
        willRespondNode.peer.node = willRespondNode;
        willRespondNode.peer.send = function (chan, msg) {
          var myId = this.node.id;
          kademlia.mockTime.setTimeout(function () {
            // This is what we would have sent.
            // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
            if (chan == 'dht' && msg.op == 'offer') {
              // Instead of sending to anybody, just call your own onMessage.
              // This is what we will receive.
              // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
              willRespondNode.onMessage(myId, {op: 'answer', to: msg.from, from: myId, answer:myId, serial:msg.serial, idx:msg.idx});
            }
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      dht.recvFindNodePrimitive('20000001', '00000000', 0, keys, callbackFn);

      kademlia.mockTime.advance(20);

      var retKeys = [
        '20000001',
        '20000002',
        '20000003',
        '20000004',
      ];
      assert.deepEqual(retVal.sort(), retKeys);
    });

    it("should return a full bucket if there are more than enough nodes to fill a bucket.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4, unexpectedMsg: 'throw'});

      var keys = [
        '20000001',
        '20000002',
        '20000003',
        '20000004',
        '40000001',
      ];
      for (var i=0; i<keys.length; i++) {
        var key1 = keys[i];
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
        willRespondNode.peer.node = willRespondNode;
        willRespondNode.peer.send = function (chan, msg) {
          var node = this.node;
          var myId = this.node.id;
          kademlia.mockTime.setTimeout(function () {
            // This is what we would have sent.
            // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
            if (chan == 'dht' && msg.op == 'offer') {
              // Instead of sending to anybody, just call your own onMessage.
              // This is what we will receive.
              // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
              node.onMessage(myId, {op: 'answer', to: msg.from, from: myId, answer:myId, serial:msg.serial, idx:msg.idx});
            }
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      var reqs = [1,2,3,4];
      dht.recvFindNodePrimitive('20000001', '00000000', 0, reqs, callbackFn);

      kademlia.mockTime.advance(20);

      var retKeys = [
        '20000001',
        '20000002',
        '20000003',
        '20000004',
      ];
      assert.deepEqual(retVal.sort(), retKeys);
    });

    it("should return a full bucket if you ask for more than a full bucket.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4, unexpectedMsg: 'throw'});

      var keys = [
        '20000001',
        '20000002',
        '20000003',
        '20000004',
        '40000001',
      ];
      for (var i=0; i<keys.length; i++) {
        var key1 = keys[i];
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
        willRespondNode.peer.node = willRespondNode;
        willRespondNode.peer.send = function (chan, msg) {
          var node = this.node;
          var myId = this.node.id;
          kademlia.mockTime.setTimeout(function () {
            // This is what we would have sent.
            // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
            if (chan == 'dht' && msg.op == 'offer') {
              // Instead of sending to anybody, just call your own onMessage.
              // This is what we will receive.
              // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
              node.onMessage(myId, {op: 'answer', to: msg.from, from: myId, answer:myId, serial:msg.serial, idx:msg.idx});
            }
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      dht.recvFindNodePrimitive('20000001', '00000000', 0, keys, callbackFn);

      kademlia.mockTime.advance(20);

      var retKeys = [
        '20000001',
        '20000002',
        '20000003',
        '20000004',
      ];
      assert.deepEqual(retVal.sort(), retKeys);
    });

    it("should return nodes from nearby buckets if the target bucket doesn't have enough nodes, but nearby buckets have some.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var keys = [
        '08000001',
        '10000001',
        '20000001',
        '40000001',
        '80000001',
      ];
      for (var i=0; i<keys.length; i++) {
        var key1 = keys[i];
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
        willRespondNode.peer.node = willRespondNode;
        willRespondNode.peer.send = function (chan, msg) {
          var node = this.node;
          var myId = this.node.id;
          kademlia.mockTime.setTimeout(function () {
            // This is what we would have sent.
            // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
            if (chan == 'dht' && msg.op == 'offer') {
              // Instead of sending to anybody, just call your own onMessage.
              // This is what we will receive.
              // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
              node.onMessage(myId, {op: 'answer', to: msg.from, from: myId, answer:myId, serial:msg.serial, idx:msg.idx});
            }
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      dht.recvFindNodePrimitive('08000001', '00000000', 0, keys, callbackFn);

      kademlia.mockTime.advance(20);

      var retKeys = [
        '08000001',
        '10000001',
        '20000001',
        '40000001',
        '80000001',
      ];
      assert.deepEqual(retVal.sort(), retKeys);
    });

    it("should try more-specific buckets first when looking in nearby buckets.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4, unexpectedMsg: 'throw'});

      var keys = [
        '08000001',
        '10000001',
        '20000001',
        '20000002',
        '20000003',
      ];
      for (var i=0; i<keys.length; i++) {
        var key1 = keys[i];
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
        willRespondNode.peer.node = willRespondNode;
        willRespondNode.peer.send = function (chan, msg) {
          var node = this.node;
          var myId = this.node.id;
          kademlia.mockTime.setTimeout(function () {
            // This is what we would have sent.
            // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
            if (chan == 'dht' && msg.op == 'offer') {
              // Instead of sending to anybody, just call your own onMessage.
              // This is what we will receive.
              // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
              node.onMessage(myId, {op: 'answer', to: msg.from, from: myId, answer:myId, serial:msg.serial, idx:msg.idx});
            }
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      var reqKeys = [1,2,3,4];
      dht.recvFindNodePrimitive('10000001', '00000000', 0, reqKeys, callbackFn);

      kademlia.mockTime.advance(20);

      var retKeys = [
        '10000001',
        '20000001',
        '20000002',
        '20000003',
      ];
      assert.deepEqual(retVal.sort(), retKeys);
    });

    it("after checking the most-specific bucket, it should move from the target bucket to less-specific buckets.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4, unexpectedMsg: 'throw'});

      var keys = [
        '04000001',
        '08000001',
        '10000001',
        '20000001',
        '20000002',
      ];
      for (var i=0; i<keys.length; i++) {
        var key1 = keys[i];
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
        willRespondNode.peer.node = willRespondNode;
        willRespondNode.peer.send = function (chan, msg) {
          var node = this.node;
          var myId = this.node.id;
          kademlia.mockTime.setTimeout(function () {
            // This is what we would have sent.
            // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
            if (chan == 'dht' && msg.op == 'offer') {
              // Instead of sending to anybody, just call your own onMessage.
              // This is what we will receive.
              // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
              node.onMessage(myId, {op: 'answer', to: msg.from, from: myId, answer:myId, serial:msg.serial, idx:msg.idx});
            }
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      var reqKeys = [1,2,3,4];
      dht.recvFindNodePrimitive('10000001', '00000000', 0, reqKeys, callbackFn);

      kademlia.mockTime.advance(20);

      var retKeys = [
        '08000001',
        '10000001',
        '20000001',
        '20000002',
      ];
      assert.deepEqual(retVal.sort(), retKeys);
    });

    it("checks the buckets at the extreme edges.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4, unexpectedMsg: 'throw'});

      var keys = [
        '00000001',
        'ffffffff',
      ];
      for (var i=0; i<keys.length; i++) {
        var key1 = keys[i];
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
        willRespondNode.peer.node = willRespondNode;
        willRespondNode.peer.send = function (chan, msg) {
          var node = this.node;
          var myId = this.node.id;
          kademlia.mockTime.setTimeout(function () {
            // This is what we would have sent.
            // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
            if (chan == 'dht' && msg.op == 'offer') {
              // Instead of sending to anybody, just call your own onMessage.
              // This is what we will receive.
              // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
              node.onMessage(myId, {op: 'answer', to: msg.from, from: myId, answer:myId, serial:msg.serial, idx:msg.idx});
            }
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      var reqKeys = [1,2,3,4];
      dht.recvFindNodePrimitive('10000001', '00000000', 0, reqKeys, callbackFn);

      kademlia.mockTime.advance(20);

      var retKeys = [
        '00000001',
        'ffffffff',
      ];
      assert.deepEqual(retVal.sort(), retKeys);
    });

    it("should not return if there is still a peer hanging.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
      willRespondNode.peer.node = willRespondNode;
      willRespondNode.peer.send = function (chan, msg) {
        var node = this.node;
        var myId = this.node.id;
        kademlia.mockTime.setTimeout(function () {
          // This is what we would have sent.
          // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
          if (chan == 'dht' && msg.op == 'offer') {
            // Instead of sending to anybody, just call your own onMessage.
            // This is what we will receive.
            // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
            node.onMessage(myId, {op: 'answer', to: msg.from, from: myId, answer:'good call', serial:msg.serial, idx:msg.idx});
          }
        }, 10);
      };
      dht._insertNode(willRespondNode);

      var key2 = '80000002';
      var slowRespondNode = new kademlia.KademliaRemoteNode({id: key2, peer: {}});
      slowRespondNode.peer.node = slowRespondNode;
      slowRespondNode.peer.send = function (chan, msg) {
        var node = this.node;
        var myId = this.node.id;
        kademlia.mockTime.setTimeout(function () {
          // This is what we would have sent.
          // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
          if (chan == 'dht' && msg.op == 'offer') {
            // Instead of sending to anybody, just call your own onMessage.
            // This is what we slow receive.
            // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
            node.onMessage(myId, {op: 'answer', to: msg.from, from: myId, answer:'slow call', serial:msg.serial, idx:msg.idx});
          }
        }, 40);
      };
      dht._insertNode(slowRespondNode);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      dht.recvFindNodePrimitive('80000001', '00000000', 0, ['fake offer', 'flake offer'], callbackFn);

      kademlia.mockTime.advance(20);

      assert.deepEqual(retVal, null);
    });

    it("should return a sensible answer even if the searched key is its own", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
      willRespondNode.peer.send = function (chan, msg) {
        kademlia.mockTime.setTimeout(function () {
          // This is what we would have sent.
          // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
          if (chan == 'dht' && msg.op == 'offer') {
            // Instead of sending to anybody, just call your own onMessage.
            // This is what we will receive.
            // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
            willRespondNode.onMessage(key1, {op: 'answer', to: msg.from, from: key1, answer:'good call', serial:msg.serial, idx:msg.idx});
          }
        }, 10);
      };
      dht._insertNode(willRespondNode);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = [];
        for (var i=0; i<answers.length; i++) {
          retVal.push(answers[i].answer);
        }
      };

      dht.recvFindNodePrimitive('00000000', '00000001', 0, ['fake offer', 'flake offer'], callbackFn);

      kademlia.mockTime.advance(20);

      assert.deepEqual(retVal, ['good call']);
    });
  });
});

describe("KademliaRemoteNode", function () {
  describe("#sendFindNodePrimitive", function () {
    it("should send a well-formed FIND_NODE request over the wire.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      var bobLog = [];

      participants.bob.addChannelMessageHandler('dht', function (peer, channel, data) {
        bobLog.push(data);
      });

      participants.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (answers) {
        // Do nothing.  I'm just checking if I sent the right stuff.
      });

      kademlia.mockTime.advance(20);

      // It should be like this:
      // [{
      //   op: 'FIND_NODE',
      //   key: '00000000',
      //   offers: [
      //     five RTCPeerConnection objects.
      //   ],
      // }]);

      var offers = bobLog[0].offers;
      delete bobLog[0].offers;

      assert.deepEqual(bobLog, [{
        op: 'FIND_NODE',
        key: '00000000',
        serial: 0,
      }]);

      // 4 is the value of k for this network.
      assert.equal(offers.length, 4);

      for (var i=0; i<4; i++) {
        offers[i] instanceof kademlia.wrtc.RTCPeerConnection;
      }
    });

    it("should receive a bucket full of answers in response.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      // Fill in Bob with some other nodes.
      var keys = [
        '08000001',
        '10000001',
        '20000001',
        '20000002',
      ];
      for (var i=0; i<keys.length; i++) {
        var key1 = keys[i];
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: {}});
        willRespondNode.peer.node = willRespondNode;
        willRespondNode.peer.send = function (chan, msg) {
          var node = this.node;
          var myId = this.node.id;
          kademlia.mockTime.setTimeout(function () {
            // This is what we would have sent.
            // {op: 'offer', from: aliceKey, offer: offer, idx: idx, }
            if (chan == 'dht' && msg.op == 'offer') {
              // Instead of sending to anybody, just call your own onMessage.
              // This is what we will receive.
              // {"op":"answer", "to":<hex rep of Alice's key>, "from":<hex representation of Craig's key>, "answer":<answer>, "idx":<idx>}
              node.onMessage(myId, {op: 'answer', to: msg.from, from: myId, answer:myId, serial:msg.serial, idx:msg.idx});
            }
          }, 10);
        };
        bob._insertNode(willRespondNode);
      }

      var response = null;

      // We won't be getting real answers, so we won't be able to actually feed them in to WebRTCPeer.recvAnswer.  Therefore, we will replace _recvFoundNode and use it to 
      participants.bobAccordingToAlice.asAlice._recvFoundNode = function (searchedKey, searchSerial, peers, callback, answers) {
        response = [];
        for (var i=0; i<answers.length; i++) {
          response.push(answers[i].answer);
        }
      };

      participants.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        // We shouldn't get here because this callback is normally called by
        // _recvFoundNode, but we've replaced that.
        assert(0 == "This shouldn't have been called");
      });

      kademlia.mockTime.advance(100);

      assert.notEqual(response, null);

      // 4 is the value of k for this network.
      assert.equal(response.length, 4);

      var ansKeys = [
        '08000001',
        '10000001',
        '20000001',
        '20000002',
      ];

      assert.deepEqual(response.sort(), ansKeys);
    });

    it("should be able to make a complete round trip.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '40000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);
      var participants2 = matchMake(bob, craig, kademlia);

      // Now we have an Alice who knows about Bob, and a Bob, who knows about
      // Alice and Craig.  Let's see what happens when Alice asks for some
      // friends.
      var responseCraigs = null;

      participants.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      kademlia.mockTime.advance(1000);

      assert.notEqual(responseCraigs, null);

      assert.equal(Object.keys(responseCraigs).length, 1);

      assert.equal(Object.keys(responseCraigs)[0], craigKey);

      assert.equal(responseCraigs[Object.keys(responseCraigs)[0]].id, craigKey);
    });

    it("should be able to meet two new peers", function () {
      // Alice will have a connection to Bob.  Bob will have a
      // connection to Craig and Denise.
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '80000008';
      var deniseKey = '80000007';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});
      var denise = new kademlia.KademliaDHT({B: 32, id: deniseKey, k: 4, unexpectedMsg: 'throw'});

      var participantsAB = matchMake(alice, bob, kademlia);
      var participantsBC = matchMake(bob, craig, kademlia);
      var participantsBD = matchMake(bob, denise, kademlia);

      
      var responseCraigs1 = null;

      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs1 = craigs;
      });

      var dataChannelOpenCalled = 0;

      var origDataChannelOpen = kademlia.WebRTCPeer.prototype._dataChannelOpen;

      kademlia.WebRTCPeer.prototype._dataChannelOpen = function (channel) {
        dataChannelOpenCalled++;
        origDataChannelOpen.call(this, channel);
      };

      kademlia.mockTime.advance(100);

      assert.deepEqual(Object.keys(responseCraigs1).sort(), [craigKey, deniseKey].sort());
      assert.equal(dataChannelOpenCalled, 2);
    });

    it("should be able to have two concurrent searches", function () {
      // Alice will have a connection to Bob.  Bob will have a
      // connection to Craig and Denise.
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '80000008';
      var deniseKey = '80000007';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'log'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'log'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'log'});
      var denise = new kademlia.KademliaDHT({B: 32, id: deniseKey, k: 4, unexpectedMsg: 'log'});

      var participantsAB = matchMake(alice, bob, kademlia);
      var participantsBC = matchMake(bob, craig, kademlia);
      var participantsBD = matchMake(bob, denise, kademlia);

      
      var responseCraigs1 = null;
      var responseCraigs2 = null;

      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs1 = craigs;
      });
      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs2 = craigs;
      });

      var dataChannelOpenCalled = 0;

      var origDataChannelOpen = kademlia.WebRTCPeer.prototype._dataChannelOpen;

      kademlia.WebRTCPeer.prototype._dataChannelOpen = function (channel) {
        dataChannelOpenCalled++;
        origDataChannelOpen.call(this, channel);
      };

      kademlia.mockTime.advance(100);

      assert.deepEqual(Object.keys(responseCraigs1).sort(), [craigKey, deniseKey].sort());
      assert.deepEqual(Object.keys(responseCraigs2).sort(), [craigKey, deniseKey].sort());
      assert.equal(dataChannelOpenCalled, 2);
    });
  });

  describe("#onMessage", function () {
    it("should throw UnexpectedError if we get a FOUND_NODE with no search active.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      // Send an unexpected answer from Bob to Alice.
      // {"op":"FOUND_NODE", "key":<hex representation of key that was originally requested>, "serial":<the original serial number Alice sent>, "answers":[{"key":<hex rep of Craig's key>, "idx":<idx>, "answer":<answer>}]}

      var gotUnexpected = false;

      try {
        participants.bob.send('dht', {
          op: 'FOUND_NODE',
          key: '12345678',
          serial: 999,
          answers: [
            {
              key: '87654321',
              idx: 0,
              answer: "Unexpected!",
            },
          ],
        });

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.UnexpectedError) {
          gotUnexpected = true;
        } else {
          throw e;
        }
      }

      assert(gotUnexpected);
    });

    it("should throw MalformedError if Craig gets a malformed offer.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      // Send a malformed message from Alice to Bob.
      // {"op":"offer", "from":<hex representation of Alice's id>, "offer":<offer>, "serial":<the serial number that Alice sent>, "idx":<a number>}

      var gotMalformed = false;

      // Bad 'from:'
      try {
        participants.alice.send('dht', {
          op: 'offer',
          from: 0,
          serial: 12,
          idx: 0,
          offer: {fake: 'not a real offer'},
        });
        // should be a string.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad 'serial:'
      try {
        participants.alice.send('dht', {
          op: 'offer',
          from: '00000000',
          serial: '12',
          idx: 0,
          offer: {fake: 'not a real offer'},
        });
        // should be a number.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad 'idx:'
      try {
        participants.alice.send('dht', {
          op: 'offer',
          from: '00000000',
          serial: 12,
          idx: '0',
          offer: {fake: 'not a real offer'},
        });
        // should be a number.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad 'offer:'
      try {
        participants.alice.send('dht', {
          op: 'offer',
          from: '00000000',
          serial: 12,
          idx: '0',
          offer: 'not a real offer',
        });
        // should be an object.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);
    });

    it("should throw UnexpectedError if Alice gets an ICECandidate when we weren't trying to open a connection.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      // Send an unexpected answer from Bob to Alice.
      // {"op":"ICECandidate", "from":<hex rep of Craig's key>, "to":<hex rep of Alice's key>, "candidate":<whatever the ICE candidate thing is>, "serial":<the serial number Alice sent>, "idx":<idx>}

      var gotUnexpected = false;

      try {
        participants.bob.send('dht', {
          op: 'ICECandidate',
          from: '12345678',
          to: '00000000',
          serial: 999,
          idx: 7,
          candidate: {bad: "No real candidate"},
        });

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.UnexpectedError) {
          gotUnexpected = true;
        } else {
          throw e;
        }
      }

      assert(gotUnexpected);
    });

    it("should throw UnexpectedError if Bob gets an unexpected ICECandidate.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      // Send an unexpected answer from Bob to Alice.
      // {"op":"ICECandidate", "from":<hex rep of Craig's key>, "to":<hex rep of Alice's key>, "candidate":<whatever the ICE candidate thing is>, "serial":<the serial number Alice sent>, "idx":<idx>}

      var gotUnexpected = false;

      try {
        participants.alice.send('dht', {
          op: 'ICECandidate',
          from: '12345678',
          to: '88888888',
          serial: 999,
          idx: 7,
          candidate: {bad: "No real candidate"},
        });

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.UnexpectedError) {
          gotUnexpected = true;
        } else {
          throw e;
        }
      }

      assert(gotUnexpected);
    });

    it("should throw MalformedError if Alice gets a malformed ICECandidate.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      // Send a malformed ICE candidate from Bob to Alice.
      // {"op":"ICECandidate", "from":<hex rep of Craig's key>, "to":<hex rep of Alice's key>, "candidate":<whatever the ICE candidate thing is>, "serial":<the serial number Alice sent>, "idx":<idx>}

      var gotMalformed = false;

      // Bad "from:"
      try {
        participants.bob.send('dht', {
          op: 'ICECandidate',
          from: 12345678,
          to: '00000000',
          serial: 999,
          idx: 7,
          candidate: {bad: "No real candidate"},
        });
        // 'from' should be a string.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad "to:"
      try {
        participants.bob.send('dht', {
          op: 'ICECandidate',
          from: '12345678',
          to: 0,
          serial: 999,
          idx: 7,
          candidate: {bad: "No real candidate"},
        });
        // 'from' should be a string.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad "serial:"
      try {
        participants.bob.send('dht', {
          op: 'ICECandidate',
          from: '12345678',
          to: '00000000',
          serial: '999',
          idx: 7,
          candidate: {bad: "No real candidate"},
        });
        // 'serial' should be a number.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad "idx:"
      try {
        participants.bob.send('dht', {
          op: 'ICECandidate',
          from: '12345678',
          to: '00000000',
          serial: 999,
          idx: '7',
          candidate: {bad: "No real candidate"},
        });
        // 'idx' should be a string.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad "candidate:"
      try {
        participants.bob.send('dht', {
          op: 'ICECandidate',
          from: '12345678',
          to: '00000000',
          serial: 999,
          idx: 7,
          candidate: "No real candidate",
        });
        // 'candidate' should be an object.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);
    });

    it("should throw MalformedError if Bob gets a malformed ICECandidate from Alice.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      // Send a malformed ICE candidate from Bob to Alice.
      // {"op":"ICECandidate", "from":<hex rep of Craig's key>, "to":<hex rep of Alice's key>, "candidate":<whatever the ICE candidate thing is>, "serial":<the serial number Alice sent>, "idx":<idx>}

      var gotMalformed = false;

      // Bad "from:"
      try {
        participants.alice.send('dht', {
          op: 'ICECandidate',
          from: 0,
          to: '88888888',
          candidate: {bad: "No real candidate"},
        });
        // 'from' should be a string.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad "to:"
      try {
        participants.alice.send('dht', {
          op: 'ICECandidate',
          from: '00000000',
          to: 0,
          candidate: {bad: "No real candidate"},
        });
        // 'from' should be a string.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad "candidate:"
      try {
        participants.alice.send('dht', {
          op: 'ICECandidate',
          from: '00000000',
          to: '88888888',
          candidate: "No real candidate",
        });
        // 'candidate' should be an object.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);
    });

    it("should throw MalformedError if Bob gets a malformed ICECandidate from Craig.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      // Send a malformed ICE candidate from Bob to Alice.
      // {"op":"ICECandidate", "from":<hex rep of Craig's key>, "to":<hex rep of Alice's key>, "candidate":<whatever the ICE candidate thing is>, "serial":<the serial number Alice sent>, "idx":<idx>}

      var gotMalformed = false;

      // Bad "from:"
      try {
        participants.alice.send('dht', {
          op: 'ICECandidate',
          from: 12345678,
          to: '88888888',
          serial: 999,
          idx: 7,
          candidate: {bad: "No real candidate"},
        });
        // 'from' should be a string.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad "to:"
      try {
        participants.alice.send('dht', {
          op: 'ICECandidate',
          from: '12345678',
          to: 0,
          serial: 999,
          idx: 7,
          candidate: {bad: "No real candidate"},
        });
        // 'from' should be a string.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad "serial:"
      try {
        participants.alice.send('dht', {
          op: 'ICECandidate',
          from: '12345678',
          to: '88888888',
          serial: '999',
          idx: 7,
          candidate: {bad: "No real candidate"},
        });
        // 'serial' should be a number.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad "idx:"
      try {
        participants.alice.send('dht', {
          op: 'ICECandidate',
          from: '12345678',
          to: '88888888',
          serial: 999,
          idx: '7',
          candidate: {bad: "No real candidate"},
        });
        // 'idx' should be a string.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // Bad "candidate:"
      try {
        participants.alice.send('dht', {
          op: 'ICECandidate',
          from: '12345678',
          to: '88888888',
          serial: 999,
          idx: 7,
          candidate: "No real candidate",
        });
        // 'candidate' should be an object.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);
    });

    it("should throw UnexpectedError if we get a completely unexpected message.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      // Send a msg with a bad "op" from Bob to Alice.

      var gotUnexpected = false;

      // Bad "op:"
      try {
        participants.alice.send('dht', {
          op: "Unexpected op!"
        });
        // 'from' should be a string.

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.UnexpectedError) {
          gotUnexpected = true;
        } else {
          throw e;
        }
      }

      assert(gotUnexpected);

    });

    it("should throw MalformedError if we get a message that is not an object with an 'op' field.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);

      // Send a malformed message from Alice to Bob.

      var gotMalformed = false;

      // Not an object.
      try {
        participants.alice.send('dht', "Not an object");

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);

      gotMalformed = false;

      // No "op:".
      try {
        participants.alice.send('dht', {goof: "Not an object"});

        kademlia.mockTime.advance(10);
      } catch (e) {
        if (e instanceof kademlia.MalformedError) {
          gotMalformed = true;
        } else {
          throw e;
        }
      }

      assert(gotMalformed);
    });
  });
});

describe("KademliaRemoteNodeAlice", function () {
  describe("#_recvFoundNode", function () {
    it("should not open new connections to peers we already know.", function () {
      // Alice will have a connection to Bob and Craig.  Bob will have a
      // connection to Craig.
      // Alice will ask Bob for nodes around Craig.  She should detect that the
      // answer contains Craig, whom she already knows, and not open a new
      // connection.
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '80000008';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participantsAB = matchMake(alice, bob, kademlia);
      var participantsAC = matchMake(alice, craig, kademlia);
      var participantsBC = matchMake(bob, craig, kademlia);

      
      var responseCraigs = null;

      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      var dataChannelOpenCalled = false;

      kademlia.WebRTCPeer.prototype._dataChannelOpen = function (channel) {
        dataChannelOpenCalled = true;
      };

      // We will get an UnexpectedError.  That is because the Craig we already
      // know will send us ICE Candidates because it doesn't know who it's
      // talking to, but Alice knows that the Craig is someone it knows, so
      // does not set out any listeners for that ICE Candidate.
      assert.throws(function () { kademlia.mockTime.advance(100); }, kademlia.UnexpectedError);

      assert.deepEqual(Object.keys(responseCraigs), [craigKey]);
      assert.equal(responseCraigs[craigKey], participantsAC.bobAccordingToAlice);
      assert(!dataChannelOpenCalled);
    });

    it("should be able to use a mix of known and unknown peers.", function () {
      // Alice will have a connection to Bob and Craig.  Bob will have a
      // connection to Craig and Denise.
      // Alice will ask Bob for nodes around Craig.  She should detect that the
      // answer contains Craig, whom she already knows, and not open a new
      // connection.  She should, however, open a connection to Denise.
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '80000008';
      var deniseKey = '80000007';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'log'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'log'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'log'});
      var denise = new kademlia.KademliaDHT({B: 32, id: deniseKey, k: 4, unexpectedMsg: 'log'});

      var participantsAB = matchMake(alice, bob, kademlia);
      var participantsAC = matchMake(alice, craig, kademlia);
      var participantsBC = matchMake(bob, craig, kademlia);
      var participantsBD = matchMake(bob, denise, kademlia);

      
      var responseCraigs = null;

      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      var dataChannelOpenCalled = 0;

      var origDataChannelOpen = kademlia.WebRTCPeer.prototype._dataChannelOpen;

      kademlia.WebRTCPeer.prototype._dataChannelOpen = function (channel) {
        dataChannelOpenCalled++;
        origDataChannelOpen.call(this, channel);
      };

      kademlia.mockTime.advance(100);

      // Alice will get an unexpected ICE candidate.  That is because the Craig we already
      // know will send us ICE Candidates because it doesn't know who it's
      // talking to, but Alice knows that the Craig is someone it knows, so
      // does not set out any listeners for that ICE Candidate.
      assert.deepEqual(alice.unexpectedMsgLog, 
        [{
          msg: "Unexpected ICECandidate.",
          data: {
            op: 'ICECandidate',
            from: '80000008',
            to: '00000000',
            candidate: 
             { type: 'ice',
               sdp: 
                { candidate: undefined,
                  sdpMid: undefined,
                  sdpMLineIndex: undefined } },
            serial: 0,
            idx: 2 
          },
        }]);
        

      assert.deepEqual(Object.keys(responseCraigs).sort(), [craigKey, deniseKey].sort());
      assert(responseCraigs[craigKey].peer == participantsAC.bobAccordingToAlice.peer);
      assert.equal(dataChannelOpenCalled, 1);
    });

    it("should only open one connection if the answer to concurrent searches overlaps", function () {
      // Alice will have a connection to Bob.
      // Bob will have a connection to seven peers.  The peers will be in buckets like so:
      // B1: [P1, P2, P3], B2: [P4], B3: [P5, P6, P7]
      // Alice will launch two concurrent searches.  One on bucket B1, one on bucket B2.
      // Therefore, the correct answers to the searches will be:
      // [P1, P2, P3, P4]
      // [P4, P5, P6, P7]
      // The test is:  Was a connection opened to each peer exactly once, and
      // most especially, did P4 correctly get one connection opened, and not
      // 2?
      var kademlia = mockTimedKademlia();

      var aliceKey = '10000000';
      var bobKey   = '00000000';
      var craigKeys = [
        // bucket B1
        '00010000', '00010001', '00010002',
        // bucket B2
        '00001000',
        // bucket B3
        '00000100', '00000101', '00000102'
      ];

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var craigs = [];
      for (var i=0; i<craigKeys.length; i++) {
        craigs.push(new kademlia.KademliaDHT({B: 32, id: craigKeys[i], k: 4, unexpectedMsg: 'throw'}));
        matchMake(bob, craigs[craigs.length-1], kademlia);
      }

      // Double-check my assumptions that they got into the right buckets.
      assert.deepEqual(Object.keys(bob.buckets[8]), ['00000100', '00000101', '00000102']);
      assert.deepEqual(Object.keys(bob.buckets[12]), ['00001000']);
      assert.deepEqual(Object.keys(bob.buckets[16]), ['00010000', '00010001', '00010002']);

      var participantsAB = matchMake(alice, bob, kademlia);
      
      var responseCraigs1 = null;
      var responseCraigs2 = null;

      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000100', function (craigs) {
        responseCraigs1 = craigs;
      });
      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00001000', function (craigs) {
        responseCraigs2 = craigs;
      });

      var dataChannelOpenCalled = 0;

      var origDataChannelOpen = kademlia.WebRTCPeer.prototype._dataChannelOpen;

      kademlia.WebRTCPeer.prototype._dataChannelOpen = function (channel) {
        dataChannelOpenCalled++;
        origDataChannelOpen.call(this, channel);
      };

      kademlia.mockTime.advance(100);

      assert.deepEqual(Object.keys(responseCraigs1).sort(), ['00000100', '00000101', '00000102', '00001000'].sort());
      assert.deepEqual(Object.keys(responseCraigs2).sort(), ['00001000', '00010000', '00010001', '00010002'].sort());
      assert.equal(dataChannelOpenCalled, 7);
    });

    it("should return an empty bucket if we fail to open a channel to anyone in time.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '10000000';
      var bobKey   = '00000000';
      var craigKeys = ['00010000', '00010001', '00010002', '00001000'];

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var craigs = [];
      var participantsBC = [];
      for (var i=0; i<craigKeys.length; i++) {
        craigs.push(new kademlia.KademliaDHT({B: 32, id: craigKeys[i], k: 4, unexpectedMsg: 'throw'}));
        participantsBC.push(matchMake(bob, craigs[craigs.length-1], kademlia));
      }

      var participantsAB = matchMake(alice, bob, kademlia);
      
      var responseCraigs1 = null;

      var iceCandidatesPrevented = [];

      // Make sure that none of the channels can open.
      kademlia.KademliaRemoteNodeAlice.prototype.recvIceCandidate = function (searchSerial, idx, peer, candidate) {
        iceCandidatesPrevented.push(candidate);
      };

      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000100', function (craigs) {
        responseCraigs1 = craigs;
      });

      var dataChannelOpenCalled = 0;

      var origDataChannelOpen = kademlia.WebRTCPeer.prototype._dataChannelOpen;

      kademlia.WebRTCPeer.prototype._dataChannelOpen = function (channel) {
        dataChannelOpenCalled++;
        origDataChannelOpen.call(this, channel);
      };

      kademlia.mockTime.advance(1000);

      assert(iceCandidatesPrevented.length > 0);
      assert.equal(dataChannelOpenCalled, 0);
      assert.deepEqual(responseCraigs1, []);
    });

    it("should return a partially-full bucket if we open a channel to some of them in time.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '10000000';
      var bobKey   = '00000000';
      var craigKeys = ['00010000', '00010001', '00010002', '00001000'];

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});

      var craigs = [];
      var participantsBC = [];
      for (var i=0; i<craigKeys.length; i++) {
        craigs.push(new kademlia.KademliaDHT({B: 32, id: craigKeys[i], k: 4, unexpectedMsg: 'throw'}));
        participantsBC.push(matchMake(bob, craigs[craigs.length-1], kademlia));
      }

      var participantsAB = matchMake(alice, bob, kademlia);
      
      var responseCraigs1 = null;

      var iceCandidatesPrevented = [];

      // Make sure that none of the channels can open.
      var allowedIceCandidates = [];
      orig_recvIceCandidate = kademlia.KademliaRemoteNodeAlice.prototype.recvIceCandidate;

      kademlia.KademliaRemoteNodeAlice.prototype.recvIceCandidate = function (searchSerial, idx, peer, candidate) {
        if (idx == 0) {
          orig_recvIceCandidate.call(this, searchSerial, idx, peer, candidate);

          allowedIceCandidates.push(candidate);
        } else {
          iceCandidatesPrevented.push(candidate);
        }
      };

      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000100', function (craigs) {
        responseCraigs1 = craigs;
      });

      var dataChannelOpenCalled = 0;

      var origDataChannelOpen = kademlia.WebRTCPeer.prototype._dataChannelOpen;

      kademlia.WebRTCPeer.prototype._dataChannelOpen = function (channel) {
        dataChannelOpenCalled++;
        origDataChannelOpen.call(this, channel);
      };

      kademlia.mockTime.advance(1000);

      assert(allowedIceCandidates.length > 0);
      assert(iceCandidatesPrevented.length > 0);
      assert.equal(dataChannelOpenCalled, 1);
      assert.equal(Object.keys(responseCraigs1).length, 1);
    });

    it("should clear the lists of listeners for FOUND_NODE and ICECandidate after a successful FIND_NODE.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '40000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);
      var participants2 = matchMake(bob, craig, kademlia);

      // Now we have an Alice who knows about Bob, and a Bob, who knows about
      // Alice and Craig.  Let's see what happens when Alice asks for some
      // friends.
      var responseCraigs = null;

      participants.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      kademlia.mockTime.advance(1000);

      assert.notEqual(responseCraigs, null);

      assert.equal(Object.keys(responseCraigs).length, 1);

      assert.equal(Object.keys(responseCraigs)[0], craigKey);

      assert.equal(responseCraigs[Object.keys(responseCraigs)[0]].id, craigKey);

      // Make sure the listeners are empty.
      assert.deepEqual(participants.bobAccordingToAlice.listeners['FOUND_NODE'], {});
      assert.deepEqual(participants.bobAccordingToAlice.listeners['ICECandidate'], {});
    });

    it("should clear the lists of listeners for FOUND_NODE and ICECandidate after a successful FIND_NODE where we knew all the peers.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '40000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participantsAB = matchMake(alice, bob, kademlia);
      var participantsBC = matchMake(bob, craig, kademlia);
      var participantsAC = matchMake(alice, craig, kademlia);

      // Now we have an Alice who knows about Bob and Craig, and a Bob, who knows about
      // Alice and Craig.  Let's see what happens when Alice asks for some
      // friends.
      var responseCraigs = null;

      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      // We will get an UnexpectedError.  That is because the Craig we already
      // know will send us ICE Candidates because it doesn't know who it's
      // talking to, but Alice knows that the Craig is someone it knows, so
      // does not set out any listeners for that ICE Candidate.
      assert.throws(function () { kademlia.mockTime.advance(1000); }, kademlia.UnexpectedError);

      assert.notEqual(responseCraigs, null);

      assert.equal(Object.keys(responseCraigs).length, 1);

      assert.equal(Object.keys(responseCraigs)[0], craigKey);

      assert.equal(responseCraigs[Object.keys(responseCraigs)[0]].id, craigKey);

      // Make sure the listeners are empty.
      assert.deepEqual(participantsAB.bobAccordingToAlice.listeners['FOUND_NODE'], {});
      assert.deepEqual(participantsAB.bobAccordingToAlice.listeners['ICECandidate'], {});
    });

    it("should clear the lists of listeners for FOUND_NODE and ICECandidate after a successful FIND_NODE where only some peers responded.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '40000000';
      var deniseKey = '40000004';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});
      var denise = new kademlia.KademliaDHT({B: 32, id: deniseKey, k: 4, unexpectedMsg: 'throw'});

      var participantsAB = matchMake(alice, bob, kademlia);
      var participantsBC = matchMake(bob, craig, kademlia);
      var participantsBD = matchMake(bob, denise, kademlia);

      // Now we have an Alice who knows about Bob, and a Bob, who knows about
      // Alice, Craig, and Denise.  Let's see what happens when Alice asks for some
      // friends.
      var responseCraigs = null;

      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      // Ignore ICE Candidates from Craig.
      var iceCandidatesPrevented = [];
      var allowedIceCandidates = [];
      orig_recvIceCandidate = kademlia.KademliaRemoteNodeAlice.prototype.recvIceCandidate;

      kademlia.KademliaRemoteNodeAlice.prototype.recvIceCandidate = function (searchSerial, idx, peer, candidate) {
        if (idx == 3) {
          iceCandidatesPrevented.push(candidate);
        } else {
          orig_recvIceCandidate.call(this, searchSerial, idx, peer, candidate);

          allowedIceCandidates.push(candidate);
        }
      };

      kademlia.mockTime.advance(10000);

      assert.notEqual(responseCraigs, null);

      assert.equal(Object.keys(responseCraigs).length, 1);

      assert.equal(Object.keys(responseCraigs)[0], deniseKey);

      assert.equal(responseCraigs[Object.keys(responseCraigs)[0]].id, deniseKey);

      // Make sure the listeners are empty.
      assert.deepEqual(participantsAB.bobAccordingToAlice.listeners['FOUND_NODE'], {});
      assert.deepEqual(participantsAB.bobAccordingToAlice.listeners['ICECandidate'], {});
    });

    it("should clear the lists of listeners for FOUND_NODE and ICECandidate after timeout when waiting for FOUND_NODE.", function () {
      assert(0);
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '40000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);
      var participants2 = matchMake(bob, craig, kademlia);

      // Now we have an Alice who knows about Bob, and a Bob, who knows about
      // Alice and Craig.  Let's see what happens when Alice asks for some
      // friends.
      var responseCraigs = null;

      participants.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      kademlia.mockTime.advance(1000);

      assert.notEqual(responseCraigs, null);

      assert.equal(Object.keys(responseCraigs).length, 1);

      assert.equal(Object.keys(responseCraigs)[0], craigKey);

      assert.equal(responseCraigs[Object.keys(responseCraigs)[0]].id, craigKey);

      // Make sure the listeners are empty.
      assert.deepEqual(participants.bobAccordingToAlice.listeners['FOUND_NODE'], {});
      assert.deepEqual(participants.bobAccordingToAlice.listeners['ICECandidate'], {});
    });

    it("make sure the lists of listeners for FOUND_NODE and ICECandidate are empty after a successful FIND_NODE in which we knew all the Craigs already.", function () {
      assert(0);
    });
  });

  describe("#_cancelIceListener", function () {
    it("should be able to cancel ice listener after ice timeout", function () {
      // Alice has a connection to Bob.  Bob has a connection to Craig.  
      // Alice sends a FIND_NODE to Bob.  Bob responds with a FOUND_NODE
      // containing Craig.  Alice sends an offer to Craig.  Craig responds with
      // an answer.  The channel never opens.  Does Craig correctly give up on
      // Alice?
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '80000008';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participantsAB = matchMake(alice, bob, kademlia);
      var participantsBC = matchMake(bob, craig, kademlia);

      var peerAbandoned = [];

      orig_recvFoundNode = participantsAB.aliceAccordingToBob._recvFoundNode;

      kademlia.KademliaRemoteNodeAlice.prototype._recvFoundNode = function (searchedKey, searchSerial, peers, callback, answers) {
        var orig = this;
        setTimeout(function () {
          orig_recvFoundNode.call(orig, searchedKey, searchSerial, peers, callback, answers);
        }, 20000);
      };

      var orig_abandonPendingPeer = kademlia.KademliaRemoteNodeCraig.prototype.abandonPendingPeer;
      kademlia.KademliaRemoteNodeCraig.prototype.abandonPendingPeer = function (aliceKey) {
        peerAbandoned.push(aliceKey);
        orig_abandonPendingPeer.call(this, aliceKey);
      };

      var orig_cancelIceListener = kademlia.KademliaRemoteNodeAlice.prototype._cancelIceListener;

      kademlia.KademliaRemoteNodeAlice.prototype._cancelIceListener = function (searchSerial, idx) {
        orig_cancelIceListener.call(this, searchSerial, idx);
        
        if (typeof this.node.iceTimeouts[this.node.dht.id] == "undefined") {
          // We're in this situation after we've deleted the last callback.
          assert.equal(typeof this.node.iceTimeouts[this.node.dht.id], "undefined");
          assert.equal(typeof this.node.listeners['ICECandidate'][this.node.dht.id], "undefined");
        } else {
          assert.equal(typeof this.node.iceTimeouts[this.node.dht.id][searchSerial][idx], "undefined");
          assert.equal(typeof this.node.listeners['ICECandidate'][this.node.dht.id][searchSerial][idx], "undefined");
        }
      };

      var responseCraigs1 = null;
      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000100', function (craigs) {
        responseCraigs1 = craigs;
      });

      kademlia.mockTime.advance(5500);

      assert.deepEqual(peerAbandoned, [aliceKey]);

      kademlia.mockTime.advance(20000);

      // _recvFoundNode will never complete, so it won't return the empty response.
      assert.deepEqual(responseCraigs1, null);

      assert.equal(typeof participantsAB.bobAccordingToAlice.iceTimeouts[participantsAB.bobAccordingToAlice.dht.id], "undefined");
      assert.equal(typeof participantsAB.bobAccordingToAlice.listeners['ICECandidate'][participantsAB.bobAccordingToAlice.dht.id], "undefined");

      assert.equal(typeof participantsAB.bobAccordingToAlice.iceTimeouts[participantsAB.bobAccordingToAlice.dht.id], "undefined");
    });
  });
});

describe("KademliaRemoteNodeBob", function () {
  describe("#sendFoundNode", function () {
    it("should clear the lists of listeners for ICECandidate and answer after a successful FIND_NODE.", function () {
      assert(0);
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '40000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);
      var participants2 = matchMake(bob, craig, kademlia);

      // Now we have an Alice who knows about Bob, and a Bob, who knows about
      // Alice and Craig.  Let's see what happens when Alice asks for some
      // friends.
      var responseCraigs = null;

      participants.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      kademlia.mockTime.advance(1000);

      assert.notEqual(responseCraigs, null);

      assert.equal(Object.keys(responseCraigs).length, 1);

      assert.equal(Object.keys(responseCraigs)[0], craigKey);

      assert.equal(responseCraigs[Object.keys(responseCraigs)[0]].id, craigKey);

      // Make sure the listeners are empty.
      assert.deepEqual(participants.bobAccordingToAlice.listeners['FOUND_NODE'], {});
      assert.deepEqual(participants.bobAccordingToAlice.listeners['ICECandidate'], {});
    });
    
  });
});

describe("KademliaRemoteNodeCraig", function () {
  describe("#recvOffer", function () {
    it("should abandon a peer a certain time after it sends an answer, if no response", function () {
      // Alice has a connection to Bob.  Bob has a connection to Craig.  
      // Alice sends a FIND_NODE to Bob.  Bob responds with a FOUND_NODE
      // containing Craig.  Alice sends an offer to Craig.  Craig responds with
      // an answer.  The channel never opens.  Does Craig correctly give up on
      // Alice?
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '80000008';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participantsAB = matchMake(alice, bob, kademlia);
      var participantsBC = matchMake(bob, craig, kademlia);

      var peerAbandoned = [];

      orig_recvFoundNode = participantsAB.aliceAccordingToBob._recvFoundNode;

      kademlia.KademliaRemoteNodeAlice.prototype._recvFoundNode = function (searchedKey, searchSerial, peers, callback, answers) {
        var orig = this;
        setTimeout(function () {
          orig_recvFoundNode.call(orig, searchedKey, searchSerial, peers, callback, answers);
        }, 20000);
      };

      var orig_abandonPendingPeer = kademlia.KademliaRemoteNodeCraig.prototype.abandonPendingPeer;
      kademlia.KademliaRemoteNodeCraig.prototype.abandonPendingPeer = function (aliceKey) {
        peerAbandoned.push(aliceKey);
        orig_abandonPendingPeer.call(this, aliceKey);
      };

      var responseCraigs1 = null;
      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000100', function (craigs) {
        responseCraigs1 = craigs;
      });

      kademlia.mockTime.advance(5500);

      assert.deepEqual(peerAbandoned, [aliceKey]);

      // _recvFoundNode will never complete, so it won't return the empty response.
      assert.deepEqual(responseCraigs1, null);
    });

    it("should raise an UnexpectedError if an abandoned peer responds after all", function () {
      // Alice has a connection to Bob.  Bob has a connection to Craig.  
      // Alice sends a FIND_NODE to Bob.  Bob responds with a FOUND_NODE
      // containing Craig.  Alice sends an offer to Craig.  Craig responds with
      // an answer.  The channel never opens.  Does Craig correctly give up on
      // Alice?
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '80000008';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participantsAB = matchMake(alice, bob, kademlia);
      var participantsBC = matchMake(bob, craig, kademlia);

      var peerAbandoned = [];

      var orig_recvFoundNode = participantsAB.aliceAccordingToBob.asAlice._recvFoundNode;

      kademlia.KademliaRemoteNodeAlice.prototype._recvFoundNode = function (searchedKey, searchSerial, peers, callback, answers) {
        var orig = this;
        kademlia.mockTime.setTimeout(function () {
          orig_recvFoundNode.call(orig, searchedKey, searchSerial, peers, callback, answers);
        }, 20000);
      };

      var orig_abandonPendingPeer = kademlia.KademliaRemoteNodeCraig.prototype.abandonPendingPeer;
      kademlia.KademliaRemoteNodeCraig.prototype.abandonPendingPeer = function (aliceKey) {
        peerAbandoned.push(aliceKey);
        orig_abandonPendingPeer.call(this, aliceKey);
      };

      var responseCraigs1 = null;
      participantsAB.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000100', function (craigs) {
        responseCraigs1 = craigs;
      });

      kademlia.mockTime.advance(5500);

      assert.deepEqual(peerAbandoned, [aliceKey]);

      assert.throws(function () { kademlia.mockTime.advance(30000); }, kademlia.UnexpectedError);

      // _recvFoundNode will never complete, so it won't return the empty response.
      assert.deepEqual(responseCraigs1, null);
    });
  });

  describe("#recvOffer", function () {
    it("should clear the list of listeners for ICECandidate after the data channel opens.", function () {
      assert(0);
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '40000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);
      var participants2 = matchMake(bob, craig, kademlia);

      // Now we have an Alice who knows about Bob, and a Bob, who knows about
      // Alice and Craig.  Let's see what happens when Alice asks for some
      // friends.
      var responseCraigs = null;

      participants.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      kademlia.mockTime.advance(1000);

      assert.notEqual(responseCraigs, null);

      assert.equal(Object.keys(responseCraigs).length, 1);

      assert.equal(Object.keys(responseCraigs)[0], craigKey);

      assert.equal(responseCraigs[Object.keys(responseCraigs)[0]].id, craigKey);

      // Make sure the listeners are empty.
      assert.deepEqual(participants.bobAccordingToAlice.listeners['FOUND_NODE'], {});
      assert.deepEqual(participants.bobAccordingToAlice.listeners['ICECandidate'], {});
    });

    it("should clear the list of listeners for ICECandidate after timeout when waiting to open the data channel.", function () {
      assert(0);
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '40000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4, unexpectedMsg: 'throw'});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4, unexpectedMsg: 'throw'});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4, unexpectedMsg: 'throw'});

      var participants = matchMake(alice, bob, kademlia);
      var participants2 = matchMake(bob, craig, kademlia);

      // Now we have an Alice who knows about Bob, and a Bob, who knows about
      // Alice and Craig.  Let's see what happens when Alice asks for some
      // friends.
      var responseCraigs = null;

      participants.bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      kademlia.mockTime.advance(1000);

      assert.notEqual(responseCraigs, null);

      assert.equal(Object.keys(responseCraigs).length, 1);

      assert.equal(Object.keys(responseCraigs)[0], craigKey);

      assert.equal(responseCraigs[Object.keys(responseCraigs)[0]].id, craigKey);

      // Make sure the listeners are empty.
      assert.deepEqual(participants.bobAccordingToAlice.listeners['FOUND_NODE'], {});
      assert.deepEqual(participants.bobAccordingToAlice.listeners['ICECandidate'], {});
    });
  });
});
