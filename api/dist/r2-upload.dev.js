"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.generatePresignedUrl = generatePresignedUrl;
exports.setupR2Cors = setupR2Cors;

var _clientS = require("@aws-sdk/client-s3");

var _s3RequestPresigner = require("@aws-sdk/s3-request-presigner");

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

function _getRequireWildcardCache() { if (typeof WeakMap !== "function") return null; var cache = new WeakMap(); _getRequireWildcardCache = function _getRequireWildcardCache() { return cache; }; return cache; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") { return { "default": obj }; } var cache = _getRequireWildcardCache(); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj["default"] = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

// Initialize R2 Client
var R2 = new _clientS.S3Client({
  region: 'auto',
  endpoint: "https://".concat(process.env.CLOUDFLARE_ACCOUNT_ID, ".r2.cloudflarestorage.com"),
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});
var BUCKET_NAME = 'images'; // Your bucket name
// Express route handler (or adapt to your framework)

function generatePresignedUrl(req, res) {
  var _req$query, filename, contentType, timestamp, randomStr, extension, key, command, presignedUrl;

  return regeneratorRuntime.async(function generatePresignedUrl$(_context) {
    while (1) {
      switch (_context.prev = _context.next) {
        case 0:
          _context.prev = 0;
          _req$query = req.query, filename = _req$query.filename, contentType = _req$query.contentType;

          if (!(!filename || !contentType)) {
            _context.next = 4;
            break;
          }

          return _context.abrupt("return", res.status(400).json({
            error: 'filename and contentType required'
          }));

        case 4:
          // Generate unique filename with timestamp
          timestamp = Date.now();
          randomStr = Math.random().toString(36).substring(7);
          extension = filename.split('.').pop();
          key = "posts/".concat(timestamp, "-").concat(randomStr, ".").concat(extension); // Create presigned URL

          command = new _clientS.PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            ContentType: contentType
          });
          _context.next = 11;
          return regeneratorRuntime.awrap((0, _s3RequestPresigner.getSignedUrl)(R2, command, {
            expiresIn: 3600 // URL expires in 1 hour

          }));

        case 11:
          presignedUrl = _context.sent;
          // Return presigned URL and key
          res.json({
            url: presignedUrl,
            key: key,
            publicUrl: "https://pub-yourhash.r2.dev/".concat(key) // Replace with your public R2 domain

          });
          _context.next = 19;
          break;

        case 15:
          _context.prev = 15;
          _context.t0 = _context["catch"](0);
          console.error('Error generating presigned URL:', _context.t0);
          res.status(500).json({
            error: 'Failed to generate upload URL'
          });

        case 19:
        case "end":
          return _context.stop();
      }
    }
  }, null, null, [[0, 15]]);
} // Setup CORS for your R2 bucket (run once)
// You need to do this from your backend or using AWS CLI


function setupR2Cors() {
  var _ref, PutBucketCorsCommand, corsConfig, command;

  return regeneratorRuntime.async(function setupR2Cors$(_context2) {
    while (1) {
      switch (_context2.prev = _context2.next) {
        case 0:
          _context2.next = 2;
          return regeneratorRuntime.awrap(Promise.resolve().then(function () {
            return _interopRequireWildcard(require('@aws-sdk/client-s3'));
          }));

        case 2:
          _ref = _context2.sent;
          PutBucketCorsCommand = _ref.PutBucketCorsCommand;
          corsConfig = {
            Bucket: BUCKET_NAME,
            CORSConfiguration: {
              CORSRules: [{
                AllowedHeaders: ['content-type', 'x-amz-*'],
                AllowedMethods: ['PUT', 'GET'],
                AllowedOrigins: ['http://localhost:8100', 'https://yourdomain.com'],
                // Add your domains
                ExposeHeaders: [],
                MaxAgeSeconds: 3600
              }]
            }
          };
          command = new PutBucketCorsCommand(corsConfig);
          _context2.next = 8;
          return regeneratorRuntime.awrap(R2.send(command));

        case 8:
          console.log('CORS configured successfully');

        case 9:
        case "end":
          return _context2.stop();
      }
    }
  });
}
//# sourceMappingURL=r2-upload.dev.js.map
