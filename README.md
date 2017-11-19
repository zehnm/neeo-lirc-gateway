# NEEO driver for LIRC
Send IR commands with LIRC to control IR devices with NEEO which are not directly reachable by the brain.

* NEEO - The Thinking Remote: https://neeo.com
* Linux Infrared Remote Control: http://www.lirc.org/

Available commands are retrieved from lircd and dynamically added to the NEEO driver.

The LIRC daemon is controlled over a network connection with Node.js module [lirc-client](https://github.com/hobbyquaker/lirc-client).
This NEEO driver can run anywhere on the network, even on a Windows machine, as long as it's able to connect to the remote LIRC daemon.
I'm running lircd on a Raspberry Zero-W and the driver on a Linux Intel server.

**Attention: proof of concept only!**
Needs lots of improvements and this is my first Node.js hack...

Tested with:
 - NEEO SDK 0.47.8 https://github.com/NEEOInc/neeo-sdk
 - LIRC 0.9.0-pre1 running on Raspbian Stretch light (2017-09-07)
 - Denon DRA-F109 (see doc/lircd.conf)

## Requirements
 - Node.js >= v6.12 (https://nodejs.org)
 - LIRC properly configured with activated network listening.
   - Make sure you are able to send IR commands with irsend
   - Telnet test to output all defined remotes in lircd.conf:
```
telnet <HOST> 8765
LIST
```

## Installation
Download or clone the code from github.
```
git clone https://github.com/zehnm/neeo-lirc-gateway.git
```
Install required packages with npm
```
npm install
```

## Configuration
**Edit the config.json file to adjust the driver settings** 
 - neeo.brainIp : IP address of the NEEO brain (optional).
   Auto discovery is active if not specified. 
   See issue: https://github.com/NEEOInc/neeo-sdk/issues/36
 - neeo.callbackIp : IP address of machine running the driver (optional).
   Most likely required if auto discovery doesn't work.
 - neeo.callbackPort : local port number for device server
 - lirc.host : host name or address of lircd
 - lirc.port : port number of lircd

**Edit the key-mapping.json file to adjust LIRC to NEEO mappings** 
 LIRC keys are automatically mapped if the name starts with prefix 'KEY\_' or 'SRC\_' for source inputs.
 All other keys can be mapped in key-mapping.json.
 - Pay special attention to NEEO's button groups, i.e. the special button naming. See: https://github.com/NEEOInc/neeo-sdk 
 - The LIRC name is used if NEEO name is not specified. 
 - The NEEO label is derived from the key name if it's not specified.

## Start the driver

```
node index.js 
```
