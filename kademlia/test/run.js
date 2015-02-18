var assert = require('assert');
var mock = require('mock');
var mockTimer = require('time-mock');

function mockTimedKademlia() {
  var mockTime = mockTimer(0);

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
        var b1  = dht._hex2BitStream(key1);
        var node = new kademlia.KademliaRemoteNode({id: key1, bitId: b1, peer: null});

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
      var b1   = dht._hex2BitStream(key1);
      var node = new kademlia.KademliaRemoteNode({id: key1, bitId: b1, peer: null});
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

    it("should never contact the requesting node to fulfil its own request.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var b1   = dht._hex2BitStream(key1);
      var callMeNode = new kademlia.KademliaRemoteNode({id: key1, bitId: b1, peer: null});
      callMeNode.recvOffer = function (offer, recvAnswerCallback) {
        kademlia.mockTime.setTimeout(function () {
          recvAnswerCallback('good call');
        }, 10);
      };
      dht._insertNode(callMeNode);

      var key2 = '80000002';
      var b2   = dht._hex2BitStream(key2);
      var dontCallNode = new kademlia.KademliaRemoteNode({id: key2, bitId: b2, peer: null});
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

      dht.recvFindNodePrimitive('80000001', '80000002', ['fake offer'], callbackFn);

      kademlia.mockTime.advance(20);

      assert.deepEqual(retVal, ['good call']);
    });

    it("should return an empty bucket if nobody responds in time.", function () {
      var kademlia = mockTimedKademlia();

      var dht = new kademlia.KademliaDHT({B: 32, id: '00000000'});

      var key1 = '80000001';
      var b1   = dht._hex2BitStream(key1);
      var node = new kademlia.KademliaRemoteNode({id: key1, bitId: b1, peer: null});
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
      assert(0);
    });

    it("should return a partially-full bucket if there are not enough nodes to fill a bucket, and should return as soon as all nodes respond.", function () {
      assert(0);
    });

    it("should return a full bucket if there are enough nodes to fill a bucket.", function () {
      assert(0);
    });

    it("should return a full bucket if there are more than enough nodes to fill a bucket.", function () {
      assert(0);
    });

    it("should return nodes from nearby buckets if the target bucket doesn't have enough nodes, but nearby buckets have some.", function () {
      assert(0);
    });
  });
});
