import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('exports bounded request/status labels and histogram buckets', () => {
    const metrics = new MetricsService();
    metrics.requestStarted();
    metrics.requestFinished('get', '/api/screens/:id', 200, 0.12);
    metrics.requestStarted();
    metrics.requestFinished('GET', '/api/screens/:id', 404, 0.03);

    const text = metrics.render();

    expect(text).toContain('wizer_api_http_active_requests 0');
    expect(text).toContain(
      'wizer_api_http_requests_total{method="GET",route="/api/screens/:id",status_class="2xx"} 1',
    );
    expect(text).toContain(
      'wizer_api_http_requests_total{method="GET",route="/api/screens/:id",status_class="4xx"} 1',
    );
    expect(text).toContain('wizer_api_http_request_duration_seconds_bucket');
    expect(text).toContain('le="+Inf"');
    expect(text).not.toContain('companyId');
    expect(text).not.toContain('userId');
  });

  it('never lets active request gauge go negative on duplicate close/finish accounting', () => {
    const metrics = new MetricsService();
    metrics.requestFinished('GET', 'unmatched', 500, 1);

    expect(metrics.render()).toContain('wizer_api_http_active_requests 0');
  });

  it('escapes Prometheus label values', () => {
    const metrics = new MetricsService();
    metrics.requestStarted();
    metrics.requestFinished('GET', '/api/quoted"route\\x', 200, 0.001);

    const text = metrics.render();
    expect(text).toContain('route="/api/quoted\\"route\\\\x"');
  });
});
