'use strict'

////////////////////// START Jaeger Stuff /////////////////////////
// Auto instrumentation MUST BE ON FIRST LINE TO KICK IN!!!
const Instrument = require('@risingstack/opentracing-auto')

// Jaeger tracer (standard distributed tracing)
const jaeger = require('jaeger-client')
const UDPSender = require('jaeger-client/dist/src/reporters/udp_sender').default
const sampler = new jaeger.RateLimitingSampler(1)
// Need this since the Jaeger server parts (reporter, collector, storage etc) are running outside the scope of our
// Docker stack in this PoC. Real case scenario, the Jaeger server parts will either run in the same
// Docker stack or in a separate Docker stack but on the same host to avoid network latency to the reporter
const reporter = new jaeger.RemoteReporter(new UDPSender({
  // host: 'docker.for.mac.localhost',
  host: 'localhost',
  port: 6832
}))
const jaegerTracer = new jaeger.Tracer('jaeger-poc-nodejs-jaeger-tracer', reporter, sampler)

// Metrics tracer ("free" metrics data through the use of a second tracer)
const {Tags, FORMAT_HTTP_HEADERS} = require('opentracing')
const MetricsTracer = require('@risingstack/opentracing-metrics-tracer')
const prometheusReporter = new MetricsTracer.PrometheusReporter()
const metricsTracer = new MetricsTracer('jaeger-poc-nodejs-metrics-tracer', [prometheusReporter])

const instrument = new Instrument({
  tracers: [metricsTracer, jaegerTracer]
})
////////////////////// END Jaeger Stuff /////////////////////////

// THESE GET AUTO INSTRUMENTED THANKS TO THE FIRST LINE
const express = require('express')
const http = require('http')

var app = express()

// Perform two sequential calls over http to the two APIs (redis and postgres)
app.get('/orchestrate', (req, res) => {
  // http.get({host: 'redisapi', port: 8081, path: '/counter'}, (redisResponse) => {
  http.get({host: 'localhost', port: 8081, path: '/counter'}, (redisResponse) => {
    var redisBody = ''
    redisResponse.on('data', (d) => { redisBody += d }) // Consume chunks
    redisResponse.on('end', () => {
      // http.get({host: 'postgresapi', port: 8082, path: '/pgdata'}, (pgResponse) => {
      http.get({host: 'localhost', port: 8082, path: '/pgdata'}, (pgResponse) => {
        var pgBody = ''
        pgResponse.on('data', (d) => { pgBody += d }) // Consume chunks
        pgResponse.on('end', () => {
          res.end('Redis counter: ' + redisBody + '\n' + 'PG data: ' + pgBody + '\n')
        })
      }).on('error', (e) => {
        res.status(500)
        res.end('Some Error Message')
      })
    })
  }).on('error', (e) => {
    res.status(500)
    res.end('Some Other Error Message')
  })
})

// Metrics endpoint, typically for scraping with Prometheus or equivalent
app.get('/metrics', (req, res) => {
  res.set('Content-Type', MetricsTracer.PrometheusReporter.Prometheus.register.contentType)
  res.end(prometheusReporter.metrics())
})

http.createServer(app).listen(8080, function () {
  console.log('Listening on port 8080')
})


