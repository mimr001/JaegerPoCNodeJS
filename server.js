const express = require('express')
const http = require('http')

var app = express()

app.get('/', function(req, res, next) {
  http.get({
    host: 'redisapi',
    port: 8081,
    path: '/counter'
  }, function(redisResponse) {
    var redisBody = '';
    redisResponse.on('data', function(d) { redisBody += d; });
    redisResponse.on('end', function() {
      http.get({
        host: 'postgresapi',
        port: 8082,
        path: '/pgdata'
      }, function(pgResponse) {
        var pgBody = '';
        pgResponse.on('data', function(d) { pgBody += d; });
        pgResponse.on('end', function() {
          res.send('Redis counter: ' + redisBody + '<br/>' + 'PG data: ' + pgBody)
        });
      })
    });
  })
});

http.createServer(app).listen(8080, function() {
  console.log('Listening on port 8080');
});