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

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4});

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

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4});

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

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4});

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

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4});

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

    it("should try less-specific buckets second when looking in nearby buckets.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000', k: 4});

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
  });
});

describe("KademliaRemoteNode", function () {
  describe("#sendFindNodePrimitive", function () {
    it("should send a well-formed FIND_NODE request over the wire.", function () {
      var kademlia = mockTimedKademlia();

      var participants = kademlia.makePair();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4});

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
      var bobAccordingToAlice = new kademlia.KademliaRemoteNode({id: bobKey, peer: participants.alice});
      var aliceAccordingToBob = new kademlia.KademliaRemoteNode({id: aliceKey, peer: participants.bob});

      alice._insertNode(bobAccordingToAlice);
      bob._insertNode(aliceAccordingToBob);

      // Now actually start communication.
      participants.alice.createOffer();
      kademlia.mockTime.advance(5);

      var bobLog = [];

      participants.bob.addChannelMessageHandler('dht', function (peer, channel, data) {
        bobLog.push(data);
      });

      bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (answers) {
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

      var participants = kademlia.makePair();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4});

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
      var bobAccordingToAlice = new kademlia.KademliaRemoteNode({id: bobKey, peer: participants.alice});
      var aliceAccordingToBob = new kademlia.KademliaRemoteNode({id: aliceKey, peer: participants.bob});

      alice._insertNode(bobAccordingToAlice);
      bob._insertNode(aliceAccordingToBob);

      // These handlers would normally be added as part of the kademlia
      // process.  There will also be a process to add them when bootstrapping
      // the network.  For now, I am bootstrapping by hand.
      bobAccordingToAlice.peer.addChannelMessageHandler('dht', function (peer, channel, data) {
        bobAccordingToAlice.onMessage(bob.id, data);
      });
      aliceAccordingToBob.peer.addChannelMessageHandler('dht', function (peer, channel, data) {
        aliceAccordingToBob.onMessage(alice.id, data);
      });

      // Now actually start communication.
      participants.alice.createOffer();
      kademlia.mockTime.advance(5);

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
      bobAccordingToAlice.asAlice._recvFoundNode = function (searchedKey, searchSerial, peers, callback, answers) {
        response = [];
        for (var i=0; i<answers.length; i++) {
          response.push(answers[i].answer);
        }
      };

      bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
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

      var participants = kademlia.makePair();
      var participants2 = kademlia.makePair();

      assert.equal(participants.mockTime, participants2.mockTime);

      var aliceKey = '00000000';
      var bobKey   = '10000000';
      var craigKey = '40000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4});
      var craig = new kademlia.KademliaDHT({B: 32, id: craigKey, k: 4});

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
      var bobAccordingToAlice = new kademlia.KademliaRemoteNode({id: bobKey, peer: participants.alice});
      var aliceAccordingToBob = new kademlia.KademliaRemoteNode({id: aliceKey, peer: participants.bob});

      alice._insertNode(bobAccordingToAlice);
      bob._insertNode(aliceAccordingToBob);

      // These handlers would normally be added as part of the kademlia
      // process.  There will also be a process to add them when bootstrapping
      // the network.  For now, I am bootstrapping by hand.
      bobAccordingToAlice.peer.addChannelMessageHandler('dht', function (peer, channel, data) {
        bobAccordingToAlice.onMessage(bob.id, data);
      });
      aliceAccordingToBob.peer.addChannelMessageHandler('dht', function (peer, channel, data) {
        aliceAccordingToBob.onMessage(alice.id, data);
      });

      // Now actually start communication.
      participants.alice.createOffer();
      kademlia.mockTime.advance(5);

      // Fill in Bob with some other nodes.
      var craigAccordingToBob = new kademlia.KademliaRemoteNode({id: craigKey, peer: participants2.alice});
      var bobAccordingToCraig = new kademlia.KademliaRemoteNode({id: aliceKey, peer: participants2.bob});

      bob._insertNode(craigAccordingToBob);
      craig._insertNode(bobAccordingToCraig);

      // These handlers would normally be added as part of the kademlia
      // process.  There will also be a process to add them when bootstrapping
      // the network.  For now, I am bootstrapping by hand.
      craigAccordingToBob.peer.addChannelMessageHandler('dht', function (peer, channel, data) {
        craigAccordingToBob.onMessage(craig.id, data);
      });
      bobAccordingToCraig.peer.addChannelMessageHandler('dht', function (peer, channel, data) {
        bobAccordingToCraig.onMessage(bob.id, data);
      });

      // Now we have an Alice who knows about Bob, and a Bob, who knows about
      // Alice and Craig.  Let's see what happens when Alice asks for some
      // friends.
      var responseCraigs = null;

      bobAccordingToAlice.asAlice.sendFindNodePrimitive('00000000', function (craigs) {
        responseCraigs = craigs;
      });

      kademlia.mockTime.advance(1000);

      assert.notEqual(responseCraigs, null);

      assert.equal(Object.keys(responseCraigs).length, 1);

      assert.equal(Object.keys(responseCraigs)[0], craigKey);

      assert.equal(responseCraigs[Object.keys(responseCraigs)[0]].id, craigKey);
    });

    it("should be able to have two concurrent searches", function () {
      assert(0);
    });

    it("should only open one connection if the answer to concurrent searches overlaps", function () {
      assert(0);
    });
  });

  describe("#onMessage", function () {
    it("should throw UnexpectedError if we get an answer when we didn't send an offer.", function () {
      assert(0);
    });

    it("should throw UnexpectedError if we get a FOUND_NODE with no search active.", function () {
      assert(0);
    });

    it("should throw UnexpectedError if Alice gets an ICECandidate when we weren't trying to open a connection.", function () {
      assert(0);
    });
  });
});

describe("KademliaRemoteNodeAlice", function () {
  describe("#_recvFoundNode", function () {
    it("should not open new connections to peers we already know.", function () {
      assert(0);
    });
  });
});
