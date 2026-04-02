const http = require('http')
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, 'public')
const port = 4322

http.createServer((req, res) => {
  const file = path.join(dir, req.url === '/' ? '/index.html' : req.url)
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return }
    const ext = path.extname(file)
    const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/plain'
    res.writeHead(200, { 'Content-Type': type })
    res.end(data)
  })
}).listen(port, () => console.log(`Serving on http://localhost:${port}`))
