var Boom = require("boom");
var Concat = require("concat-stream");
var Hapi = require("hapi");
var Image = require("imagemagick-stream");
var Joi = require("joi");
var LRU = require("bluebird-lru-cache");
var Promise = require("bluebird");
var Webshot = require("webshot");


if (!process.env.RUN_URL) throw new Error("RUN_URL environment variable is required.");
if (!process.env.PORT) throw new Error("PORT environment variable is required.");

var server = new Hapi.Server(process.env.PORT);


var internals = {};

internals.runUrl = process.env.RUN_URL;

internals.capture = function (url, config) {
  return new Promise(function (resolve, reject) {
    Webshot(url, config, function (err, readStream) {
      if (err) return reject(err);
      
      return resolve(readStream);
    });
  });
};

internals.prepareShot = function (key) {
  var plunkId = key.split("@")[0];
  var params = {
    errorIfStatusIsNot200: true,
    renderDelay: 3,
    screenSize: {
      width: 1024,
      height: 768,
    },
  };
  
  return internals.capture(internals.runUrl + "/plunks/" + plunkId + "/", params)
    .then(function (renderStream) {
      return new Promise(function (resolve, reject) {
        var resizeStream = Image().resize("248X186").quality(75);
        var concatStream = Concat(function (buf) {
          if (!buf.length) return reject(Boom.serverTimeout("Invalid preview, empty buffer"));
          
          resolve(buf);
        });
        
        renderStream
          .pipe(resizeStream)
          .pipe(concatStream);
      });
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
    validate: {
      params: {
        plunkId: Joi.string().alphanum().required(),
      },
      query: {
        d: Joi.string().required(),
      },
    },
    handler: function (request, reply) {
      internals.cache.get(request.params.plunkId + "@" + request.query.d)
        .then(function (buf) {
          reply(buf).type("image/png");
        }, reply);
    },
  },
});

server.pack.register({
  plugin: require("good"),
  options: {
    subscribers: {
      'console': ['ops', 'request', 'log', 'error'],
    },
  },
}, function (err) {
  if (err) {
    throw err; // something bad happened loading the plugin
  }

  server.start(function () {
    server.log('info', 'Server running at: ' + server.info.uri);
  });
});