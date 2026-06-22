import urllib.request, json

# Get token
req = urllib.request.Request(
    "http://127.0.0.1:5001/api/auth/admin-login",
    data=b"{}",
    headers={"Content-Type": "application/json"}
)
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())["access_token"]

# Read test file
import os
os.chdir("D:/Projects/pricer3d")
with open("tests/fixtures/test_cube_20mm.stl", "rb") as f:
    file_data = f.read()

# Build multipart
boundary = "----TestBoundary12345"
body = []
for name, value in [
    ("printer_model", "bambu_a1_04"),
    ("material", "PLA"),
    ("color", "#000000"),
    ("quantity", "1"),
    ("use_prusaslicer", "true"),
    ("layer_height", "0.2"),
    ("infill", "20"),
    ("wall_count", "3"),
]:
    body.append("--" + boundary)
    body.append('Content-Disposition: form-data; name="' + name + '"')
    body.append("")
    body.append(value)

body.append("--" + boundary)
body.append('Content-Disposition: form-data; name="files"; filename="test.stl"')
body.append("Content-Type: application/sla")
body.append("")

full_body = "\r\n".join(body).encode() + b"\r\n" + file_data + ("\r\n--" + boundary + "--\r\n").encode()

req = urllib.request.Request(
    "http://127.0.0.1:5001/api/quote",
    data=full_body,
    headers={
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "Authorization": "Bearer " + token,
    },
    method="POST"
)
resp = urllib.request.urlopen(req, timeout=180)
d = json.loads(resp.read())
item = d["results"][0]
print("status:", item.get("status"))
print("printer_model:", item.get("_printer_model"))

# Now check history
req2 = urllib.request.Request(
    "http://127.0.0.1:5001/api/quote/history?limit=1",
    headers={"Authorization": "Bearer " + token}
)
resp2 = urllib.request.urlopen(req2)
d2 = json.loads(resp2.read())
hi = d2["items"][0]
print("\nHistory record:")
print("  printer_model:", hi.get("printer_model"))
print("  nozzle_diameter:", hi.get("nozzle_diameter"))
