'use strict';

/*
 * NEEO driver for sending IR commands with LIRC
 * https://github.com/zehnm/neeo-lirc-gateway
 *
 * Send IR commands with LIRC to control IR devices with NEEO in other rooms.
 * 
 * Available commands are retrieved from lircd and dynamically added to the
 * NEEO driver. Keys are automatically mapped if the name starts with prefixes
 * 'KEY_' for regular commands and 'SRC_' for source inputs. All other keys can
 * be mapped in key-mapping.json. If the property name is omitted the LIRC name
 * is used. The label is derived from the key name if it's not specified.
 * 
 * The LIRC Daemon is controlled over network connection, i.e. this NEEO driver
 * can run anywhere on the network and not necessarly where lircd is installed,
 * e.g. on a remote Raspberry Zero-W.
 * 
 * Attention: proof of concept only!
 * Needs lots of improvements...
 * 
 * Tested with:
 * - Node.js v8.9.1
 * - NEEO SDK 0.47.8 https://github.com/NEEOInc/neeo-sdk
 * - LIRC 0.9.0-pre1 running on Raspbian Stretch light (2017-09-07)
 */

const neeoapi = require('neeo-sdk');
const NeeoDevice = require('./neeoDevice');
const wait = require('wait.for');

// default configuration with required parameters. Customize in config.json
// Optional: neeo.brainIp, neeo.callbackIp
var config = {
  "neeo" : {
    "callbackPort" : 6336
  },
  "lirc": {
    "host": "localhost",
    "port": 8765
  }
};

// LIRC key to NEEO mappings
const keyMap = require(__dirname + '/key-mapping.json');


console.log('NEEO device "LIRC gateway" PoC');
console.log('---------------------------------------------');

// Config file is optional
try {
  config = require(__dirname + '/config.json');
} catch (e) {
  console.warn('WARNING: Cannot find config.json! Using default values.');
}

var neeoDevices = [];

console.log('[LIRC] Connecting to LIRC daemon on %s:%d ...', config.lirc.host, config.lirc.port)
// TODO add socket option if irsend is on same host
var lirc = require('lirc-client')({
  host: config.lirc.host,
  port: config.lirc.port
});

lirc.on('error', function(err) {
  if (err == 'end' || err == 'timeout' || err.startsWith('response timeout')) {
    // lirc-client will auto-reconnect for those errors
    console.error("ERROR [LIRC]", err);
    return;
  }

  // TODO LIRC auto-reconnect if initial connection failed? Or let external caller handle it? 
  console.error("FATAL [LIRC]", err);
  process.exit(8);
});

lirc.on('connect', function () {
  wait.launchFiber(buildLircDevices);
});


// FIXME rewrite device building
function buildLircDevices() {
  try {
    var versionResult = wait.for(lirc.cmd, 'VERSION');
    console.log('[LIRC] Connected to lircd: version', versionResult.toString());

    console.log('[LIRC] Retrieving available remotes from LIRC...');
    var remotesResult = wait.for(lirc.cmd, 'LIST', '', '');
    console.log('[LIRC] Available remotes:', remotesResult.toString());

    for (var i in remotesResult) {
      var remote = remotesResult[i];
      console.log('[LIRC] Retrieving commands of remote "%s"', remote);
      var remoteCommands = wait.for(lirc.cmd, 'LIST', remote, '');

      // Quick and dirty proof of concept at the moment
      var neeoLircDevice = new NeeoDevice(lirc, remote);

      for (var index in remoteCommands) {
        var lircCmd = remoteCommands[index].split(' ')[1];
        if (!lircCmd) {
          console.error('ERROR [LIRC] %s: Parsing error remote command at index %d: %s', remote, index, remoteCommands[index]);
          continue;
        }
        var neeoCmd = keyMap[lircCmd];
        var neeoLabel = undefined;
        var neeoName = undefined;
        if (neeoCmd) {
          // use defined mapping
          neeoLabel = neeoCmd.label;
          neeoName = neeoCmd.name ? neeoCmd.name : lircCmd;
        } else if (lircCmd.startsWith("KEY_")) {
          neeoName = lircCmd.substring(4).replace('_', ' ');
        } else if (lircCmd.startsWith("SRC_")) {
          neeoName = 'INPUT ' + lircCmd.substring(4).replace('_', ' ');
        } else {
          console.warn('WARN  [LIRC] %s: Command %s could not be mapped! Either define key mapping in configuration or use key naming convention (prefixes: KEY_ and SRC_).', remote, lircCmd);
          continue;
        }
        if (!neeoLabel) {
          neeoLabel = toTitleCase(neeoName);
        }
        console.log('[LIRC] %s: %s -> NEEO "%s" (%s)', remote, lircCmd, neeoName, neeoLabel);
        neeoLircDevice.addButton(neeoName, neeoLabel, lircCmd)
      }

      neeoDevices.push(neeoLircDevice.getDevice());
    }

    var brainIp = process.env.BRAINIP;
    var baseurl = undefined;

    if (brainIp) {
      console.log('[NEEO] Using NEEO Brain IP from env variable: ', brainIp);
    } else if (config.neeo.brainIp) {
      brainIp = config.neeo.brainIp;
      console.log('[NEEO] Using NEEO Brain IP from configuration: ', brainIp);
    }

    // baseurl must be set for certain network setup (i.e. Windows with Hyper-V) until SDK is fixed.
    // See forum and related issue with auto-discovery: https://github.com/NEEOInc/neeo-sdk/issues/36
    if (config.neeo.callbackIp) {
      baseurl = 'http://' + config.neeo.callbackIp + ':' + config.neeo.callbackPort;
    }

    if (brainIp) {
      startDeviceServer(brainIp, config.neeo.callbackPort, baseurl);
    } else {
      console.log('[NEEO] discover one NEEO Brain...');
      neeoapi.discoverOneBrain()
        .then((brain) => {
          console.log('[NEEO] Brain discovered:', brain.name, baseurl);
          startDeviceServer(brain, config.neeo.callbackPort, baseurl);
        });
    }

  } catch(err) {
      console.error("FATAL [LIRC]", err);
      process.exit(1);
  }
}

function startDeviceServer(brain, port, callbackBaseurl) {
  console.log('[NEEO] Starting server...');
  neeoapi.startServer({
    brain,
    port,
    baseurl: callbackBaseurl,
    name: 'lirc-gateway',
    devices: neeoDevices
  })
    .then(() => {
      console.log('[NEEO] API server ready! Use the NEEO app to search for "LIRC gateway".');
    })
    .catch((error) => {
      console.error('FATAL [NEEO] Error starting device server!', error.message);
      process.exit(9);
    });
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, function (txt) { return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); });
}
