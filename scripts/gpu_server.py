#!/usr/bin/env python3
"""
Simple HTTP server to expose GPU metrics
Matches dashdot's /load/gpu endpoint format
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import subprocess
import sys
from collections import deque
import time

# Import the metrics collector
import gpu_metrics

# Temperature smoothing - keep last N readings
TEMP_HISTORY_SIZE = 5
temp_history = deque(maxlen=TEMP_HISTORY_SIZE)
last_update_time = 0
UPDATE_INTERVAL = 1.0  # Update readings every 1 second

# Cached metrics
cached_metrics = None

def get_smoothed_metrics():
    """Get metrics with temperature smoothing"""
    global temp_history, last_update_time, cached_metrics

    current_time = time.time()

    # Only update from sysfs every UPDATE_INTERVAL seconds
    if current_time - last_update_time >= UPDATE_INTERVAL:
        metrics = gpu_metrics.get_gpu_metrics()
        if metrics:
            temp_history.append(metrics['temp'])
            cached_metrics = metrics
        last_update_time = current_time

    # Return smoothed metrics
    if cached_metrics and temp_history:
        smoothed_temp = sum(temp_history) / len(temp_history)
        result = dict(cached_metrics)
        result['temp'] = round(smoothed_temp, 1)
        return result

    return cached_metrics

class GPUHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default logging
        pass

    def do_GET(self):
        if self.path == '/load/gpu':
            metrics = get_smoothed_metrics()
            if metrics:
                output = [metrics]
            else:
                output = []

            response = json.dumps(output).encode()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(response)
        elif self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()

def run_server(port=3002):
    server = HTTPServer(('0.0.0.0', port), GPUHandler)
    print(f"GPU metrics server running on http://0.0.0.0:{port}")
    print(f"  - GPU metrics: http://0.0.0.0:{port}/load/gpu")
    print(f"  - Health check: http://0.0.0.0:{port}/health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3002
    run_server(port)
