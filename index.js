var Boom = require("boom");
var Concat = require("concat-stream");
var Hapi = require("hapi");
var Image = require("imagemagick-stream");
var Joi = require("joi");
var LRU = require("bluebird-lru-cache");
var Promise = require("bluebird");
var Screenshot = require("screenshot-stream");


if (!process.env.RUN_URL) throw new Error("RUN_URL environment variable is required.");
if (!process.env.PORT) throw new Error("PORT environment variable is required.");

var server = new Hapi.Server(process.env.HOST || "0.0.0.0", process.env.PORT);


setTimeout(function () {
  server.log('info', 'Server exceeded maximum lifetime, exiting.');
  process.exit(0);
}, 1000 * 60 * 60);


var internals = {};

internals.runUrl = process.env.RUN_URL;

internals.prepareShot = function (key) {
  var plunkId = key.split("@")[0];
  
  return new Promise(function (resolve, reject) {
    var captureStream = Screenshot(internals.runUrl + "/plunks/" + plunkId + "/", "1024x768", {delay: 2});
    var resizeStream = Image().resize("480").gravity("NorthWest").crop("480x640").quality(75);
    var concatStream = Concat(function (buf) {
      if (!buf.length) {
        return reject(Boom.serverTimeout("Invalid preview, empty buffer"));
      }
      
      resolve(buf);
    });
    
    captureStream
      .pipe(resizeStream)
      .pipe(concatStream)
      .on("error", reject);
  });
};


internals.cache = LRU({
  max: 1024 * 1024 * 256,
  length: function (buf) { return buf.length; },
  fetchFn: internals.prepareShot,
});

server.route({
  method: "GET",
  path: "/{plunkId}.png",
  config: {
    cache: {
      expiresIn: 1000 * 60 * 60 * 24,
      privacy: 'public'
    },
    validate: {
      params: {
        plunkId: Joi.string().alphanum().required(),
      },
      query: {
        d: Joi.string().required(),
      },
    },
    handler: function (request, reply) {
      var imgId = request.params.plunkId + "@" + request.query.d;
      internals.cache.get(imgId)
        .then(function (buf) {
          reply(buf)
            .etag(imgId)
            .type("image/png");
        }, reply);
    },
  },
});

server.pack.register({
  plugin: require("good"),
  // options: {
  //   subscribers: {
  //     'console': [],
  //     '/tmp/webshot/': ['request', 'log', 'error'],
  //   },
  // },
}, function (err) {
  if (err) {
    throw err; // something bad happened loading the plugin
  }

  server.start(function () {
    server.log('info', 'Server running at: ' + server.info.uri);
  });
});
