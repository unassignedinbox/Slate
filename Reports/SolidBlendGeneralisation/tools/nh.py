"""Thin JSON-lines client for the SolidArc native GeometryHost (same protocol as GeometryMetrics.py).

A watchdog kills and restarts the host when one command exceeds its time budget. The native host is single-threaded
and has no cancellation, so a hang would otherwise stall every later trial.
"""
import json
import os
import subprocess
import threading

Root = os.environ.get('SOLIDARC_ROOT', '/home/user/ref/Frontier-')


class CommandTimeout(RuntimeError):
    pass


class Host:
    def __init__(self, limit=60.0):
        self.Limit = limit
        self.Text = []
        self.Restarts = 0
        self.Start()

    def Start(self):
        self.P = subprocess.Popen([Root + '/_AgentScratch/build/SolidArcNative/GeometryHost'], cwd=Root,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.ident = self.Ex('create')['description']['identity']

    def Ex(self, action, **v):
        req = dict(action=action, identity=getattr(self, 'ident', 0), width=800, height=600, **v)
        Watchdog = threading.Timer(self.Limit, self.P.kill)
        Watchdog.start()
        try:
            self.P.stdin.write(json.dumps(req) + '\n')
            self.P.stdin.flush()
            self.Text = []
            for line in self.P.stdout:
                if line.startswith('SOLIDARC_PACKET '):
                    return json.loads(line[len('SOLIDARC_PACKET '):])
                self.Text.append(line.rstrip('\n'))
        finally:
            Watchdog.cancel()
        # EOF without a reply: either the watchdog fired or the host crashed.
        self.Restarts += 1
        self.P.wait()
        raise CommandTimeout(f'no reply within {self.Limit}s or host exited (returncode {self.P.returncode})')

    def Cmd(self, *commands):
        return self.Ex('command', commands=list(commands))

    def Close(self):
        try:
            self.P.stdin.close()
            self.P.wait(timeout=10)
        except Exception:
            self.P.kill()
