# Sparky API

This is the back-end REST API for the Sparky chat bot. It facilitates bot to agent
escalation with ECE 11.6 and UCCX 11.x.

## Install Dependencies
`npm i`

## Run
`npm start`

## Install as a Linux systemd service
1. Edit `systemd.service` to update the install paths to match your server.
2. Copy the systemd service file to systemd: `sudo cp systemd.service /lib/systemd/system/sparky-api.service`
3. Install service with `sudo systemctl enable sparky-api.service`
4. Start service with `sudo systemctl start sparky-api.service`
5. Watch logs with `journalctl -xf`
