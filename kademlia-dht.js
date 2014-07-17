/**
 * Create a distributed hash table using the Kademlia protocol as specified here:
 *    http://xlattice.sourceforge.net/components/protocol/kademlia/specs.html
 *
 * @param options An object with some of these keys.  If a default exists, it is listed here.
 *    alpha - integer (default: 3): The amount of concurrent RPCs allowed.
 *            (we actually use "loose parallelism" - we send the next iteration
 *            of the RPC algorithm after a timeout has passed, rather than
 *            waiting for all the RPCs to return)
 *    B - integer (default: 160): The number of bits in the keys used to
 *        identify nodes and values.  For these keys, we use SHA1 hashes, hence 160 bits.
 *    k - integer (default: 20):  The maximum number of contacts stored in a bucket.
 *    tExpire - integer in seconds (default: 86410 [~one day]): The time after the
 *              original publication date after which a key/value pair expires.
 *    tRepublish - integer in seconds (default: 86400 [1 day]): After this
 *                 time, the original publisher must republish a key/value pair.
 *    tRefresh - integer in seconds (default: 3600 [1hr]): If a bucket has not
 *               been accessed in this amount of time, refresh it.
 *    tReplicate - integer in seconds (default: 3600 [1hr]): After this amount
 *                 of time, a node must publish its entire database.
 */
function KademliaDHT(options) {
  var characteristics = {
    alpha: 3,
    B: 160,
    k: 20,
    tExpire: 86410,
    tRepublish: 86400,
    tRefresh: 3600,
    tReplicate: 3600,
  };

  // Set the defaults.
  for (k in characteristics) {
    this[k] = characteristics[k];
  }

  // Allow the defaults to be overridden.
  if (typeof options != "undefined") {
    for (k in characteristics) {
      if (typeof options[k] != "undefined") {
        this[k] = options[k];
      }
    }
  }

  // Initialize the buckets.
  this.buckets = new Array(this.B);
  for (var i=0; i<a.length; i++) {
    this.buckets[i] = new Array(this.k);
  }
}

module.exports = exports = KademliaDHT;

/**
 * Bootstrap the network.
 * We can't directly contact other peers using WebRTC.  Instead, we must use
 * Websocket (or ajax, but we are using websocket here) to contact one or more
 * bootstrap servers, who can coordinate our introduction to peers.
 * If we have more than one bootstrap server, ask each of them to supply us with peers.  
 * The bootstrap an iterativeFindNode for our node_id, but it is passed by
 * websocket instead of webrtc.
 * @node_id string The node_id of this node.
 * @param servers list of bootstrap servers to contact.  If this is empty, a
 * new one will be generated.
 */
KademliaDHT.prototype.bootstrap = function (servers, node_id) {
  if (typeof node_id == "undefined") {
    node_id = this.generateNodeId();
  }
};

KademliaDHT.prototype.serveBootstrap = function () {
};

KademliaDHT.prototype.generateNodeId = function () {
  // XXX I need to find a SHA-1 package and figure out how to get enough entropy.
};
