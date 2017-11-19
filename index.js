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
 * - Node.js v6.12.0
 * - NEEO SDK 0.47.8 https://github.com/NEEOInc/neeo-sdk
 * - LIRC 0.9.0-pre1 running on Raspbian Stretch light (2017-09-07)
 */

const neeoapi = require('neeo-sdk');

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
// Reverse NEEO name to LIRC key map
var neeoButtonMap = new Map();
// FIXME create map: NEEO deviceId -> LIRC remote name
var lircRemoteName;


console.log('NEEO device "LIRC gateway" PoC');
console.log('---------------------------------------------');

// Config file is optional
try {
  config = require(__dirname + '/config.json');
} catch (e) {
  console.log('WARNING: Cannot find config.json! Using default values.');
}

// Quick and dirty proof of concept at the moment
var neeoLircDevice = neeoapi.buildDevice('irsend gateway') // TODO include remote name
  .setManufacturer('LIRC')
  .addAdditionalSearchToken('SDK')
  .addAdditionalSearchToken('irsend')
  .setType('MEDIAPLAYER') // TODO: better device type available? This is super annoying with NEEO's cable salad insisting on TV or AVR :-(
  .addButtonHander((name, deviceid) => neeoButtonPressed(name, deviceid));

console.log('Connecting to LIRC server %s:%d ...', config.lirc.host, config.lirc.port)
// TODO add socket option if irsend is on same host
var lirc = require('lirc-client')({
  host: config.lirc.host,
  port: config.lirc.port
});

// FIXME LIRC auto-reconnect if initial connection failed
// FIXME rewrite initialization code. Wait for LIRC connection, then build device(s)
lirc.on('connect', function () {
  lirc.cmd('VERSION', function (err, versionResult) {
    if (err) {
      console.log('[LIRC] Error getting LIRC version', err);
      process.exit(1);
    }
    if (versionResult) {
      console.log('[LIRC] Connected to LIRC Version', versionResult.toString());
    }
  });

  console.log('Retrieving available remotes from LIRC...');
  lirc.cmd('LIST', '', '', function (err, remotesResult) {
    if (err) {
      console.log('[LIRC] LIST failed:', err);
      process.exit(1);
    }
    if (remotesResult) {
      console.log('[LIRC] Available remotes:', remotesResult.toString());
      // FIXME create individual NEEO devices for each remote
      if (remotesResult.length > 1) {
        console.log('Warning: PoC only supports one LIRC remote. Using first remote...');
      }
      for (var i in remotesResult) {
        var remote = remotesResult[i]
        lircRemoteName = remote; // FIXME PoC hack
        lirc.cmd('LIST', remote, '', function (err, remoteCommands) {
          if (err) {
            console.log('[LIRC] LIST of remote %s failed: %s', remote, err);
            process.exit(1);
          }
          if (remoteCommands) {
            for (var index in remoteCommands) {
              var lircCmd = remoteCommands[index].split(' ')[1];
              var neeoCmd = keyMap[lircCmd];
              var neeoLabel = undefined;
              var neeoName;
              if (neeoCmd) {
                // use defined mapping
                neeoLabel = neeoCmd.label;
                neeoName = neeoCmd.name ? neeoCmd.name : lircCmd;
              } else if (lircCmd.startsWith("KEY_")) {
                neeoName = lircCmd.substring(4).replace('_', ' ');
              } else if (lircCmd.startsWith("SRC_")) {
                neeoName = 'INPUT ' + lircCmd.substring(4).replace('_', ' ');
              } else {
                console.log('[LIRC] Warning: command %s could not be mapped! Either define key mapping in configuration or use key naming convention (prefixes: KEY_ and SRC_).', lircCmd);
                continue;
              }
              if (!neeoLabel) {
                neeoLabel = toTitleCase(neeoName);
              }
              console.log('[LIRC] %s: %s -> NEEO "%s" (%s)', remote, lircCmd, neeoName, neeoLabel);
              neeoButtonMap.set(neeoName, lircCmd);
              neeoLircDevice.addButton({ name: neeoName, label: neeoLabel });
            }
          }

          var brainIp = process.env.BRAINIP;
          var baseurl = undefined;

          if (brainIp) {
            console.log('- use NEEO Brain IP from env variable: ', brainIp);
          } else if (config.neeo.brainIp) {
            brainIp = config.neeo.brainIp;
            console.log('- use NEEO Brain IP from configuration: ', brainIp);
          }

          // baseurl must be set for certain network setup (i.e. Windows with Hyper-V) until SDK is fixed.
          // See forum and related issue with auto-discovery: https://github.com/NEEOInc/neeo-sdk/issues/36
          if (config.neeo.callbackIp) {
            baseurl = 'http://' + config.neeo.callbackIp + ':' + config.neeo.callbackPort;
          }

          if (brainIp) {
            startDeviceServer(brainIp, config.neeo.callbackPort, baseurl);
          } else {
            console.log('- discover one NEEO Brain...');
            neeoapi.discoverOneBrain()
              .then((brain) => {
                console.log('- Brain discovered:', brain.name, baseurl);
                startDeviceServer(brain, config.neeo.callbackPort, baseurl);
              });
          }

        });

        break; // FIXME PoC hack
      }
    }
  });
});

// just for testing...
lirc.on('receive', function (remote, button, repeat) {
  console.log('button ' + button + ' on remote ' + remote + ' was pressed!');
});


function startDeviceServer(brain, port, callbackBaseurl) {
  console.log('- Start server');
  neeoapi.startServer({
    brain,
    port,
    baseurl: callbackBaseurl,
    name: 'lirc-gateway',
    devices: [neeoLircDevice]
  })
    .then(() => {
      console.log('# READY! use the NEEO app to search for "LIRC gateway".');
    })
    .catch((error) => {
      console.error('ERROR!', error.message);
      process.exit(1);
    });
}

function neeoButtonPressed(name, deviceid) {
  // FIXME map NEEO device back to LIRC remote name
  // TOOD how to set or get a unique deviceid and not just 'default'?
  var lircName = lircRemoteName;
  
  var lircKey = neeoButtonMap.get(name);
  if (lircKey) {
    console.log('ButtonPressed "%s" on %s: Sending LIRC key %s', name, deviceid, lircKey);

    // TODO use SEND_START and SEND_STOP for repeatable buttons like volume up / down
    lirc.cmd('SEND_ONCE', lircName, lircKey, function (err) {
      if (err) {
        console.log('[LIRC] SEND_ONCE failed:', err);
      }
    });
  } else {
    console.log('Warning: Undefined LIRC key for ButtonPressed "%s" on %s.', name, deviceid);
  }
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, function (txt) { return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); });
}
