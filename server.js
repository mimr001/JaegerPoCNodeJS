const express = require('express')
const http = require('http')

////////////////////// START Jaeger Stuff /////////////////////////
// Metrics tracer ("free" metrics data through the use of a second tracer)
const {Tags, FORMAT_HTTP_HEADERS} = require('opentracing')
const MetricsTracer = require('@risingstack/opentracing-metrics-tracer')
const prometheusReporter = new MetricsTracer.PrometheusReporter()
const metricsTracer = new MetricsTracer('jaeger-poc-nodejs-metrics-tracer', [prometheusReporter])

// Jaeger tracer (standard distributed tracing)
const jaeger = require('jaeger-client')
const UDPSender = require('jaeger-client/dist/src/reporters/udp_sender').default
const sampler = new jaeger.RateLimitingSampler(1)
// Need this since the Jaeger server parts (reporter, collector, storage etc) are running outside the scope of our
// Docker stack in this PoC. Real case scenario, the Jaeger server parts will either run in the same
// Docker stack or in a separate Docker stack but on the same host to avoid network latency to the reporter
const reporter = new jaeger.RemoteReporter(new UDPSender({
  host: 'docker.for.mac.localhost',
  // host: 'localhost',
  port: 6832
}))
const jaegerTracer = new jaeger.Tracer('jaeger-poc-nodejs-jaeger-tracer', reporter, sampler)

// Auto instrumentation
const Instrument = require('@risingstack/opentracing-auto')
const instrument = new Instrument({
  tracers: [metricsTracer, jaegerTracer]
})
////////////////////// END Jaeger Stuff /////////////////////////


var app = express()

// Perform two sequential calls over http to the two APIs (redis and postgres)
app.get('/orchestrate', (req, res, next) => {
  // TODO Fix this with .map() call on instrument.tracers instead
  var metricsSpan = createRpcSpan('GET/', req, metricsTracer)
  var jaegerSpan = createRpcSpan('GET/', req, jaegerTracer)
  var spans = [metricsSpan, jaegerSpan]

  console.log('In orchestrator endpoint, calling redis and postgres')
  jaegerSpan.log({info: 'In orchestrator endpoint, calling redis and postgres'})

  http.get('http://redisapi:8081/counter', (redisResponse) => {
    var redisBody = ''
    redisResponse.on('data', (d) => { redisBody += d }) // Consume chunks
    redisResponse.on('end', () => {
      http.get('http://postgresapi:8082/pgdata', (pgResponse) => {
        var pgBody = ''
        pgResponse.on('data', (d) => { pgBody += d }) // Consume chunks
        pgResponse.on('end', () => {
          spans.map((s) => s.finish()) // Close spans
          res.send('Redis counter: ' + redisBody + '<br/>' + 'PG data: ' + pgBody)
        })
      }).on('error', (e) => {
        jaegerSpan.log({error: 'Error calling postgresapi' + e})
        spans.map((s) => s.setTag(Tags.HTTP_STATUS_CODE, 500)) // Indicate error
        spans.map((s) => s.finish()) // Close spans
        res.status(500)
        res.send('Some Error Message')
      })
    })
  }).on('error', (e) => {
    jaegerSpan.log({error: 'Error calling redisapi' + e})
    spans.map((s) => s.setTag(Tags.HTTP_STATUS_CODE, 500)) // Indicate error
    spans.map((s) => s.finish()) // Close spans
    res.status(500)
    res.send('Some Other Error Message')
  })
})

// Metrics endpoint, typically for scraping with Prometheus or equivalent
app.get('/metrics', (req, res) => {
  res.set('Content-Type', MetricsTracer.PrometheusReporter.Prometheus.register.contentType)
  res.end(prometheusReporter.metrics())
})

function createRpcSpan(name, req, tracer) {
  // Instrumentation, check for any relevant http headers (debug ids etc)
  const span = tracer.startSpan(name, {
    childOf: tracer.extract(FORMAT_HTTP_HEADERS, req.headers)
  })
  const headers = {}

  tracer.inject(span, FORMAT_HTTP_HEADERS, headers)

  span.setTag(Tags.HTTP_URL, req.url)
  span.setTag(Tags.HTTP_METHOD, req.method || 'GET')
  // FIXME How do we know that here??? Should prob be set after success/failed call
  span.setTag(Tags.HTTP_STATUS_CODE, 200)
  span.setTag(Tags.SPAN_KIND_RPC_CLIENT, true)

  return span
}

http.createServer(app).listen(8080, function () {
  console.log('Listening on port 8080')
})


