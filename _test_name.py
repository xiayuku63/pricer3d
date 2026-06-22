import urllib.request, json, os

os.chdir("D:/Projects/pricer3d")

req = urllib.request.Request("http://127.0.0.1:5001/api/auth/admin-login", data=b"{}",
    headers={"Content-Type": "application/json"})
token = json.loads(urllib.request.urlopen(req).read())["access_token"]

with open("tests/fixtures/test_cube_20mm.stl", "rb") as f:
    fd = f.read()

B = "----B12345"
parts = []
for n, v in [("printer_model","bambu_x1c"),("material","PLA"),("color","#000000"),
             ("quantity","1"),("use_prusaslicer","true"),("layer_height","0.2"),
             ("infill","20"),("wall_count","3")]:
    parts.append("--" + B)
    parts.append('Content-Disposition: form-data; name="' + n + '"')
    parts.append("")
    parts.append(v)
parts.append("--" + B)
parts.append('Content-Disposition: form-data; name="files"; filename="t.stl"')
parts.append("Content-Type: application/sla")
parts.append("")
body = "\r\n".join(parts).encode() + b"\r\n" + fd + b"\r\n--" + B.encode() + b"--\r\n"

req2 = urllib.request.Request("http://127.0.0.1:5001/api/quote", data=body,
    headers={"Content-Type": "multipart/form-data; boundary=" + B, "Authorization": "Bearer " + token},
    method="POST")
d = json.loads(urllib.request.urlopen(req2, timeout=120).read())
print("status:", d["results"][0].get("status"))

req3 = urllib.request.Request("http://127.0.0.1:5001/api/quote/history?limit=1",
    headers={"Authorization": "Bearer " + token})
d2 = json.loads(urllib.request.urlopen(req3).read())
hi = d2["items"][0]
print("printer_model:", hi.get("printer_model"))
print("nozzle_diameter:", hi.get("nozzle_diameter"))
