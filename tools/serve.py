# Dev server: static files with caching disabled (ES modules are re-fetched on every reload).
import http.server
import sys


class NoCache( http.server.SimpleHTTPRequestHandler ):

	def end_headers( self ):
		self.send_header( 'Cache-Control', 'no-store' )
		super().end_headers()

	def log_message( self, *args ):
		pass


port = int( sys.argv[ 1 ] ) if len( sys.argv ) > 1 else 5217
http.server.ThreadingHTTPServer( ( '127.0.0.1', port ), NoCache ).serve_forever()
