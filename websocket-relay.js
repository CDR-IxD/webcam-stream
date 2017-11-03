// Use the websocket-relay to serve a raw MPEG-TS over WebSockets. You can use
// ffmpeg to feed the relay. ffmpeg -> websocket-relay -> browser
// Example:
// node websocket-relay yoursecret 8081 8082
// ffmpeg -i <some input> -f mpegts http://localhost:8081/yoursecret

var fs = require('fs'),
	http = require('http'),
	WebSocket = require('ws');

if (! process.env.STREAM_SECRET) {
	console.log(
		'Usage: \n' +
		'STREAM_SECRET=<secret> [STREAM_PORT=<stream-port>] [WEBSOCKET_PORT=<websocket-port>] node websocket-relay.js'
	);
	process.exit();
}

var STREAM_SECRET  = process.env.STREAM_SECRET, // no default, this one's required.
  	STREAM_PORT    = process.env.STREAM_PORT    || 8081,
  	WEBSOCKET_PORT = process.env.WEBSOCKET_PORT || 8082,
  	RECORD_STREAM  = process.env.RECORD_STREAM  || false;

function startWebClientServer(websocket_port) {
  // Websocket Server
  var socketServer = new WebSocket.Server({port: websocket_port || WEBSOCKET_PORT, perMessageDeflate: false});
  socketServer.connectionCount = 0;
  socketServer.on('connection', function(socket, upgradeReq) {
  	socketServer.connectionCount++;
  	console.log(
  		'New WebSocket Connection: ', 
  		(upgradeReq || socket.upgradeReq).socket.remoteAddress,
  		(upgradeReq || socket.upgradeReq).headers['user-agent'],
  		'('+socketServer.connectionCount+' total)'
  	);
  	socket.on('close', function(code, message){
  		socketServer.connectionCount--;
  		console.log(
  			'Disconnected WebSocket ('+socketServer.connectionCount+' total)'
  		);
  	});
  });
  socketServer.broadcast = function(data) {
  	socketServer.clients.forEach(function each(client) {
  		if (client.readyState === WebSocket.OPEN) {
  			client.send(data);
  		}
  	});
  };  
  console.log('Awaiting WebSocket connections on ws://127.0.0.1:'+(websocket_port || WEBSOCKET_PORT)+'/');
  return socketServer;
}

function startStreamProxyServer(socketServer, stream_port, record_stream) {
  // HTTP Server to accept incomming MPEG-TS Stream from ffmpeg
  var streamServer = http.createServer( function(request, response) {
  	var params = request.url.substr(1).split('/');

  	if (params[0] !== STREAM_SECRET) {
  		console.log(
  			'Failed Stream Connection: ' + request.socket.remoteAddress + ':' +
  			request.socket.remotePort + ' - wrong secret.'
  		);
  		response.end();
  	}

  	response.connection.setTimeout(0);
  	console.log(
  		'Stream Connected: ' + 
  		request.socket.remoteAddress + ':' +
  		request.socket.remotePort
  	);
  	request.on('data', function(data){
  		socketServer.broadcast(data);
  		if (request.socket.recording) {
  			request.socket.recording.write(data);
  		}
  	});
  	request.on('end',function(){
  		console.log('close');
  		if (request.socket.recording) {
  			request.socket.recording.close();
  		}
  	});

  	// Record the stream to a local file?
  	if (record_stream !== false || RECORD_STREAM) {
  		var path = 'recordings/' + Date.now() + '.ts';
  		request.socket.recording = fs.createWriteStream(path);
  	}
  }).listen(stream_port || STREAM_PORT);
  console.log('Listening for incomming MPEG-TS Stream on http://127.0.0.1:'+(stream_port || STREAM_PORT)+'/<secret>');
}

function middleware(req, res, next) {
  if (req.url === '/view-stream.html') {
    res.sendFile('view-stream.html', {root: __dirname});
  } else if (req.url === '/jsmpeg.min.js') {
    res.sendFile('jsmpeg.min.js', {root: __dirname});
  }
}

module.exports.startWebClientServer = startWebClientServer;
module.exports.startStreamProxyServer = startStreamProxyServer;
module.exports.middleware = middleware;
  
if (require.name === module) {
  startWebClientServer();
  startStreamProxyServer();
  // no middleware, that's on you!
}
