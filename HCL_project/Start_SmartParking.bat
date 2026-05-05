@echo off
echo Starting Smart Parking WebSockets Backend...
start /min python server.py

echo Starting Smart Parking Frontend Server...
start /min python -m http.server 8000

echo Waiting for servers to initialize...
timeout /t 2 /nobreak > nul

echo Opening Website...
start http://localhost:8000/

exit
