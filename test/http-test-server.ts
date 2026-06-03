// * Imports
import {createServer} from 'node:http'
import type {Server, ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'

// * Route table
// A single loopback HTTP server whose path-based routes drive every classification branch of
// `check_url` offline, with no third-party dependency (see the [2026-05-31] testing decision in
// JOURNAL.org).  Each route maps a path to a fixed response:
//
//   /ok        -> 200
//   /redirect  -> 302, Location: /ok
//   /auth      -> 401
//   /forbidden -> 403
//   /missing   -> 404
//   /boom      -> 500
//   /never     -> never responds (the connection hangs, forcing a client-side timeout)
//   /head-405  -> 405 on HEAD, 200 on GET (covers the HEAD->GET fallback)
//   any other  -> 404
//
// `/never` deliberately leaks an open connection; `close()` calls `closeAllConnections()` so a
// throwing test cannot wedge `node --test` exit on the dangling socket.

// ** route
function route(method: string, path: string, res: ServerResponse): void {
	switch (path) {
		case '/ok':
			res.writeHead(200, {'Content-Type': 'text/plain'})
			res.end('ok')
			return
		case '/redirect':
			res.writeHead(302, {Location: '/ok'})
			res.end()
			return
		case '/auth':
			res.writeHead(401)
			res.end()
			return
		case '/forbidden':
			res.writeHead(403)
			res.end()
			return
		case '/missing':
			res.writeHead(404)
			res.end()
			return
		case '/boom':
			res.writeHead(500)
			res.end()
			return
		case '/never':
			// Never responds (no server-side timer to leak), forcing a client-side timeout — see
			// the [2026-06-03] decision on why this is not a delayed-response endpoint.
			return
		case '/head-405':
			if (method === 'HEAD') {
				res.writeHead(405)
				res.end()
			} else {
				res.writeHead(200, {'Content-Type': 'text/plain'})
				res.end('ok')
			}
			return
		default:
			res.writeHead(404)
			res.end()
	}
}

// ** close_server
// Destroys open connections (so a hanging `/never` socket cannot block shutdown) and stops the
// listener.  Kept at module scope to keep `start_test_server` clear of triple-nested callbacks.
function close_server(server: Server): Promise<void> {
	server.closeAllConnections()
	return new Promise<void>((resolve, reject) => {
		server.close((err) => {
			if (err) {
				reject(err)
			} else {
				resolve()
			}
		})
	})
}

// * TestServer
interface RequestLog {method: string, path: string}

export interface TestServer {
	// Base URL with no trailing slash, e.g. `http://127.0.0.1:54321`.
	base_url: string
	// `base_url` + `path`, e.g. `url('/ok')`.
	url: (path: string) => string
	// How many requests hit `path` (any method) — for asserting a URL is probed exactly once.
	count: (path: string) => number
	// Stop the server and drop any open connections.
	close: () => Promise<void>
}

// ** start_test_server
// Starts the server on `127.0.0.1` at an ephemeral port chosen by the OS and resolves once it is
// listening.  Importing this module has no side effects — nothing starts until this is called.
export async function start_test_server(): Promise<TestServer> {
	const requests: RequestLog[] = []
	const server = createServer((req, res) => {
		const method = req.method ?? ''
		const path = req.url ?? ''
		requests.push({method, path})
		route(method, path, res)
	})
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve)
	})
	const address = server.address() as AddressInfo
	const base_url = `http://127.0.0.1:${address.port}`
	return {
		base_url,
		url: path => `${base_url}${path}`,
		count: path => requests.filter(request => request.path === path).length,
		close: () => close_server(server),
	}
}

// * closed_port
// Returns a `127.0.0.1` port that is (all but certainly) closed: bind an ephemeral port, read it,
// then release it.  A `fetch` to it gets an immediate ECONNREFUSED — a real connection failure,
// still fully offline.  (A blocked port like `:1` is no good: `fetch` rejects it as "bad port"
// without ever attempting a connection, so it exercises a different path.)
export async function closed_port(): Promise<number> {
	const server = createServer()
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve)
	})
	const address = server.address() as AddressInfo
	await close_server(server)
	return address.port
}
