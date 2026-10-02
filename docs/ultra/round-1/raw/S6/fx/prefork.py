# prefork HTTP server (gunicorn / uvicorn-workers shape): the master binds + listens, then forks N workers that
# all accept() on the same socket. usage: python3 prefork.py <port> <workers> <title> [lifeSec]
import os, sys, socket, json, time, signal
from http.server import BaseHTTPRequestHandler, HTTPServer
port, n, title = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
life = float(sys.argv[4]) if len(sys.argv) > 4 else 900
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        b = ('<!doctype html><title>%s</title><p>pid %d</p>' % (title, os.getpid())).encode()
        self.send_response(200); self.send_header('content-type', 'text/html'); self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
srv = HTTPServer(('127.0.0.1', port), H)   # binds + listens in the master
kids = []
for i in range(n):
    pid = os.fork()
    if pid == 0:
        signal.signal(signal.SIGALRM, lambda *a: os._exit(0)); signal.alarm(int(life))
        try: srv.serve_forever()
        finally: os._exit(0)
    kids.append(pid)
print(json.dumps({'listenAt': int(time.time() * 1000), 'pid': os.getpid(), 'workers': kids, 'port': port}), flush=True)
def bye(*a):
    for k in kids:
        try: os.kill(k, signal.SIGTERM)
        except Exception: pass
    os._exit(0)
signal.signal(signal.SIGTERM, bye); signal.signal(signal.SIGINT, bye)
# the master also keeps workers alive like gunicorn: respawn a worker that dies
end = time.time() + life
while time.time() < end:
    try:
        dead, _ = os.waitpid(-1, os.WNOHANG)
    except ChildProcessError:
        dead = 0
    if dead:
        kids = [k for k in kids if k != dead]
        pid = os.fork()
        if pid == 0:
            signal.signal(signal.SIGTERM, signal.SIG_DFL); signal.signal(signal.SIGINT, signal.SIG_DFL)
            signal.signal(signal.SIGALRM, lambda *a: os._exit(0)); signal.alarm(int(max(1, end - time.time())))
            try: srv.serve_forever()
            finally: os._exit(0)
        kids.append(pid)
        print(json.dumps({'respawned': pid, 'replaced': dead, 'at': int(time.time() * 1000)}), flush=True)
    time.sleep(0.2)
bye()
