# python3 page.py PORT HOST "Title": http.server serving one titled page on HOST
import http.server, sys, time
port, host, title = int(sys.argv[1]), sys.argv[2], sys.argv[3]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        b = ('<title>%s</title>ok' % title).encode(); self.send_response(200); self.send_header('Content-Type', 'text/html'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
class S(http.server.HTTPServer): allow_reuse_address = True
srv = S((host, port), H); print('LISTENING %d' % int(time.time() * 1000), flush=True); srv.serve_forever()
