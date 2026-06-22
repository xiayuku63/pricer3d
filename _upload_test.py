import json, urllib.request, uuid, time

# Login
with urllib.request.urlopen(urllib.request.Request('http://localhost:5001/api/auth/admin-login', data=b'{}', headers={'Content-Type':'application/json'})) as r:
    token = json.loads(r.read())['access_token']

# Upload
boundary = str(uuid.uuid4())
ts = str(int(time.time()))
filename = 'test_' + ts + '.stl'

with open('static/test_cube.stl', 'rb') as f:
    filedata = f.read()

body = b''
body += ('--' + boundary + '\r\n').encode()
body += ('Content-Disposition: form-data; name="files"; filename="' + filename + '"\r\n').encode()
body += b'Content-Type: application/octet-stream\r\n\r\n'
body += filedata + b'\r\n'

for k, v in [('printer_model', 'bambu_a1_04'), ('auto_orient', 'true'), ('material', 'PETG'), ('color', '#ff0000'), ('quantity', '1')]:
    body += ('--' + boundary + '\r\n').encode()
    body += ('Content-Disposition: form-data; name="' + k + '"\r\n\r\n').encode()
    body += v.encode() + b'\r\n'

body += ('--' + boundary + '--\r\n').encode()

req = urllib.request.Request(
    'http://localhost:5001/api/quote',
    data=body,
    headers={
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=' + boundary
    },
    method='POST'
)
with urllib.request.urlopen(req, timeout=300) as r:
    d = json.loads(r.read().decode())
    r0 = d['results'][0]
    print('FILENAME:', r0['filename'])
    print('COLOR:', r0.get('color', 'MISSING'))
