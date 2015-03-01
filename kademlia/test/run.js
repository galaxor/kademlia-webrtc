var assert = require('assert');
var mock = require('mock');
var mockTimer = require('time-mock');

function mockTimedKademlia(existingMockTime) {
  mockTime = mockTimer(0);

  var kademlia = mock("../kademlia", {
      timers: {
        setTimeout: mockTime.setTimeout,
        clearTimeout: mockTime.clearTimeout,
      },
    },
    require
  );

  kademlia.mockTime = mockTime;

  return kademlia;
}

function MockWebRTCPeer() {
  this.sendlog = [];
  this.recvlog = [];

  this.remoteEnd = null;
}
MockWebRTCPeer.prototype.send = function (msg) {
  this.log.push(msg);
  this.remoteEnd.recv(msg);
};

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

      dht.recvFindNodePrimitive('80000001', '00000000', ['fake offer'], callbackFn);

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

      dht.recvFindNodePrimitive('80000001', '80000001', ['fake offer'], callbackFn);

      assert.deepEqual(retVal, []);
    });

    it("should never contact the requesting node to fulfill its own request.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var callMeNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
      callMeNode.recvOffer = function (offer, recvAnswerCallback) {
        kademlia.mockTime.setTimeout(function () {
          recvAnswerCallback('good call');
        }, 10);
      };
      dht._insertNode(callMeNode);

      var key2 = '80000002';
      var dontCallNode = new kademlia.KademliaRemoteNode({id: key2, peer: null});
      dontCallNode.recvOffer = function (offer, recvAnswerCallback) {
        kademlia.mockTime.setTimeout(function () {
          recvAnswerCallback('bad call');
        }, 10);
      };
      dht._insertNode(dontCallNode);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      dht.recvFindNodePrimitive('80000001', '80000002', ['fake offer', 'flake offer'], callbackFn);

      kademlia.mockTime.advance(20);

      assert.deepEqual(retVal, ['good call']);
    });

    it("should return an empty bucket if nobody responds in time.", function () {
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

      dht.recvFindNodePrimitive('80000001', '00000000', ['fake offer'], callbackFn);

      // Let the time run out while we wait for answers.
      kademlia.mockTime.advance(600);
      
      assert.deepEqual(retVal, []);
    });

    it("should return only those nodes that responded in time.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
      willRespondNode.recvOffer = function (offer, recvAnswerCallback) {
        kademlia.mockTime.setTimeout(function () {
          recvAnswerCallback('good call');
        }, 10);
      };
      dht._insertNode(willRespondNode);

      var key2 = '80000002';
      var wontRespondNode = new kademlia.KademliaRemoteNode({id: key2, peer: null});
      wontRespondNode.recvOffer = function (offer, recvAnswerCallback) {
      };
      dht._insertNode(wontRespondNode);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      dht.recvFindNodePrimitive('80000001', '00000000', ['fake offer', 'flake offer'], callbackFn);

      kademlia.mockTime.advance(600);

      assert.deepEqual(retVal, ['good call']);
    });

    it("should return a partially-full bucket if there are not enough nodes to fill a bucket, and should return as soon as all nodes respond.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
      willRespondNode.recvOffer = function (offer, recvAnswerCallback) {
        kademlia.mockTime.setTimeout(function () {
          recvAnswerCallback('good call');
        }, 10);
      };
      dht._insertNode(willRespondNode);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      dht.recvFindNodePrimitive('80000001', '00000000', ['fake offer', 'flake offer'], callbackFn);

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
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
        willRespondNode.recvOffer = function (offer, recvAnswerCallback) {
          var retKey = this.id;
          kademlia.mockTime.setTimeout(function () {
            recvAnswerCallback(retKey);
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      dht.recvFindNodePrimitive('20000001', '00000000', keys, callbackFn);

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
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
        willRespondNode.recvOffer = function (offer, recvAnswerCallback) {
          var retKey = this.id;
          kademlia.mockTime.setTimeout(function () {
            recvAnswerCallback(retKey);
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      var reqs = [1,2,3,4];
      dht.recvFindNodePrimitive('20000001', '00000000', reqs, callbackFn);

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
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
        willRespondNode.recvOffer = function (offer, recvAnswerCallback) {
          var retKey = this.id;
          kademlia.mockTime.setTimeout(function () {
            recvAnswerCallback(retKey);
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      dht.recvFindNodePrimitive('20000001', '00000000', keys, callbackFn);

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
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
        willRespondNode.recvOffer = function (offer, recvAnswerCallback) {
          var retKey = this.id;
          kademlia.mockTime.setTimeout(function () {
            recvAnswerCallback(retKey);
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      dht.recvFindNodePrimitive('08000001', '00000000', keys, callbackFn);

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
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
        willRespondNode.recvOffer = function (offer, recvAnswerCallback) {
          var retKey = this.id;
          kademlia.mockTime.setTimeout(function () {
            recvAnswerCallback(retKey);
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      var reqKeys = [1,2,3,4];
      dht.recvFindNodePrimitive('10000001', '00000000', reqKeys, callbackFn);

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
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
        willRespondNode.recvOffer = function (offer, recvAnswerCallback) {
          var retKey = this.id;
          kademlia.mockTime.setTimeout(function () {
            recvAnswerCallback(retKey);
          }, 10);
        };
        dht._insertNode(willRespondNode);
      }

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      var reqKeys = [1,2,3,4];
      dht.recvFindNodePrimitive('10000001', '00000000', reqKeys, callbackFn);

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
      var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
      willRespondNode.recvOffer = function (offer, recvAnswerCallback) {
        kademlia.mockTime.setTimeout(function () {
          recvAnswerCallback('good call');
        }, 10);
      };
      dht._insertNode(willRespondNode);

      var key2 = '80000002';
      var slowRespondNode = new kademlia.KademliaRemoteNode({id: key2, peer: null});
      slowRespondNode.recvOffer = function (offer, recvAnswerCallback) {
        kademlia.mockTime.setTimeout(function () {
          recvAnswerCallback('slow call');
        }, 40);
      };
      dht._insertNode(slowRespondNode);

      var retVal = null;

      var callbackFn = function (answers) {
        retVal = answers;
      };

      dht.recvFindNodePrimitive('80000001', '00000000', ['fake offer', 'flake offer'], callbackFn);

      kademlia.mockTime.advance(20);

      assert.deepEqual(retVal, null);
    });
  });
});

describe("KademliaRemoteNode", function () {
  describe("#sendFindNodePrimitive", function () {
    it("should send a well-formed FIND_NODE request over the wire.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4});

      var bobAccordingToAlice = new kademlia.KademliaRemoteNode({id: bobKey});
      var aliceAccordingToBob = new kademlia.KademliaRemoteNode({id: aliceKey});

      alice._insertNode(bobAccordingToAlice);
      bob._insertNode(aliceAccordingToBob);

      bobAccordingToAlice.sendFindNodePrimitive('00000000', function (answers) {
        // Do nothing.  I'm just checking if I sent the right stuff.
      });

      kademlia.mockTime.advance(20);

      assert.deepEqual(bobAccordingToAlice.peer.sendLog,
        [{
          op: 'FIND_NODE',
          key: '00000000',
          offers: [
            bobAccordingToAlice.peer,
            bobAccordingToAlice.peer,
            bobAccordingToAlice.peer,
            bobAccordingToAlice.peer,
          ],
        }]);
    });

    it("should receive a well-formed FIND_NODE request over the wire.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4});

      var bobAccordingToAlice = new kademlia.KademliaRemoteNode({id: bobKey});
      var aliceAccordingToBob = new kademlia.KademliaRemoteNode({id: aliceKey});

      alice._insertNode(bobAccordingToAlice);
      bob._insertNode(aliceAccordingToBob);

      bobAccordingToAlice.sendFindNodePrimitive('00000000', function (answers) {
        // Do nothing.  I'm just checking if I sent the right stuff.
      });

      kademlia.mockTime.advance(20);

      assert.deepEqual(aliceAccordingToBob.peer.recvLog,
        [{
          op: 'FIND_NODE',
          key: '00000000',
          offers: [
            bobAccordingToAlice.peer,
            bobAccordingToAlice.peer,
            bobAccordingToAlice.peer,
            bobAccordingToAlice.peer,
          ],
        }]);
    });

    it("should receive a bucket full of nodes in response.", function () {
      var kademlia = mockTimedKademlia();

      var aliceKey = '00000000';
      var bobKey   = '10000000';

      var alice = new kademlia.KademliaDHT({B: 32, id: aliceKey, k: 4});
      var bob = new kademlia.KademliaDHT({B: 32, id: bobKey, k: 4});

      var bobAccordingToAlice = new kademlia.KademliaRemoteNode({id: bobKey});
      var aliceAccordingToBob = new kademlia.KademliaRemoteNode({id: aliceKey});

      alice._insertNode(bobAccordingToAlice);
      bob._insertNode(aliceAccordingToBob);

      // Fill in Bob with some other nodes.
      var keys = [
        '08000001',
        '10000001',
        '20000001',
        '20000002',
      ];
      for (var i=0; i<keys.length; i++) {
        var key1 = keys[i];
        var willRespondNode = new kademlia.KademliaRemoteNode({id: key1, peer: null});
        willRespondNode.recvOffer = function (offer, recvAnswerCallback) {
          var retKey = this.id;
          kademlia.mockTime.setTimeout(function () {
            recvAnswerCallback(retKey);
          }, 10);
        };
        bob._insertNode(willRespondNode);
      }

      var recvAnswers = null;

      bobAccordingToAlice.sendFindNodePrimitive('00000000', function (answers) {
        // Do nothing.  I'm just checking if I sent the right stuff.
      });

      kademlia.mockTime.advance(20);

      assert.deepEqual(recvAnswers, [
        '08000001',
        '10000001',
        '20000001',
        '20000002',
      ]);
    });
  });
});
