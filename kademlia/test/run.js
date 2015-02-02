var assert = require("assert");
var kademlia = require("../kademlia");

describe("KademliaDHT", function () {
  describe("#_pruneBucket", function () {
    it("should prune arbitrarily overfull buckets", function () {
      // I'm testing overfilling a bucket and then pruning it.
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
});
