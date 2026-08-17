import { Injectable } from '@nestjs/common';

const DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

type RequestMetric = {
  method: string;
  route: string;
  statusClass: string;
  count: number;
  durationCount: number;
  durationSum: number;
  buckets: number[];
};

/**
 * Small in-process Prometheus-compatible registry for the API's core SLI signals.
 * Labels are deliberately bounded: method + normalized route + status class.
 */
@Injectable()
export class MetricsService {
  private readonly requests = new Map<string, RequestMetric>();
  private activeRequests = 0;

  requestStarted(): void {
    this.activeRequests++;
  }

  requestFinished(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const statusClass = statusCode >= 100 ? `${Math.floor(statusCode / 100)}xx` : 'unknown';
    const normalizedMethod = method.toUpperCase().slice(0, 12) || 'UNKNOWN';
    const normalizedRoute = route || 'unmatched';
    const key = JSON.stringify([normalizedMethod, normalizedRoute, statusClass]);
    const metric = this.requests.get(key) ?? {
      method: normalizedMethod,
      route: normalizedRoute,
      statusClass,
      count: 0,
      durationCount: 0,
      durationSum: 0,
      buckets: DURATION_BUCKETS.map(() => 0),
    };

    metric.count++;
    metric.durationCount++;
    metric.durationSum += Math.max(0, durationSeconds);
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      if (durationSeconds <= DURATION_BUCKETS[i]!) {
        metric.buckets[i] = (metric.buckets[i] ?? 0) + 1;
      }
    }
    this.requests.set(key, metric);
  }

  render(): string {
    const memory = process.memoryUsage();
    const lines: string[] = [
      '# HELP wizer_api_process_uptime_seconds API process uptime in seconds.',
      '# TYPE wizer_api_process_uptime_seconds gauge',
      `wizer_api_process_uptime_seconds ${process.uptime()}`,
      '# HELP wizer_api_process_resident_memory_bytes Resident memory used by the API process.',
      '# TYPE wizer_api_process_resident_memory_bytes gauge',
      `wizer_api_process_resident_memory_bytes ${memory.rss}`,
      '# HELP wizer_api_process_heap_used_bytes V8 heap bytes currently used by the API process.',
      '# TYPE wizer_api_process_heap_used_bytes gauge',
      `wizer_api_process_heap_used_bytes ${memory.heapUsed}`,
      '# HELP wizer_api_http_active_requests Requests currently being served.',
      '# TYPE wizer_api_http_active_requests gauge',
      `wizer_api_http_active_requests ${this.activeRequests}`,
      '# HELP wizer_api_http_requests_total Completed HTTP requests by normalized route and status class.',
      '# TYPE wizer_api_http_requests_total counter',
    ];

    const metrics = [...this.requests.values()].sort((a, b) =>
      `${a.method}:${a.route}:${a.statusClass}`.localeCompare(
        `${b.method}:${b.route}:${b.statusClass}`,
      ),
    );

    for (const metric of metrics) {
      lines.push(`wizer_api_http_requests_total${this.labels(metric)} ${metric.count}`);
    }

    lines.push(
      '# HELP wizer_api_http_request_duration_seconds HTTP request duration in seconds.',
      '# TYPE wizer_api_http_request_duration_seconds histogram',
    );
    for (const metric of metrics) {
      for (let i = 0; i < DURATION_BUCKETS.length; i++) {
        lines.push(
          `wizer_api_http_request_duration_seconds_bucket${this.labels(metric, String(DURATION_BUCKETS[i]))} ${metric.buckets[i] ?? 0}`,
        );
      }
      lines.push(
        `wizer_api_http_request_duration_seconds_bucket${this.labels(metric, '+Inf')} ${metric.durationCount}`,
        `wizer_api_http_request_duration_seconds_sum${this.labels(metric)} ${metric.durationSum}`,
        `wizer_api_http_request_duration_seconds_count${this.labels(metric)} ${metric.durationCount}`,
      );
    }

    lines.push('');
    return lines.join('\n');
  }

  private labels(metric: RequestMetric, le?: string): string {
    const values: Array<[string, string]> = [
      ['method', metric.method],
      ['route', metric.route],
      ['status_class', metric.statusClass],
    ];
    if (le !== undefined) values.push(['le', le]);
    return `{${values.map(([key, value]) => `${key}="${this.escape(value)}"`).join(',')}}`;
  }

  private escape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
  }
}
