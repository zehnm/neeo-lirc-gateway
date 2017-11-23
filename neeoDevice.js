'use strict';

const neeoapi = require('neeo-sdk');

module.exports = class NeeoDevice {
    constructor(lircClient, remoteName) {
  
        this.lircClient = lircClient;
        this.remoteName = remoteName;

        // Reverse NEEO name to LIRC key map
        this.neeoButtonMap = new Map();

        this.neeoDevice = neeoapi.buildDevice('gateway ' + remoteName.replace('_', ' '))
            .setManufacturer('LIRC')
            .setType('MEDIAPLAYER') // TODO: better device type available? This is super annoying with NEEO's cable salad insisting on TV or AVR :-(
            .addAdditionalSearchToken('SDK')
            .addAdditionalSearchToken('irsend')
            .addButtonHander((name, deviceid) => this.onButtonPressed(name, deviceid));
    }

    getDevice() {
        return this.neeoDevice;
    }

    addButton(neeoName, label, lircCmd) {
        this.neeoButtonMap.set(neeoName, lircCmd);
        this.neeoDevice.addButton({ name: neeoName, label: label });
    }

    onButtonPressed(name, deviceid) {
        var lircKey = this.neeoButtonMap.get(name);
        if (lircKey) {
          console.log('[NEEO] ButtonPressed "%s" on %s: Sending LIRC key %s to %s', name, deviceid, lircKey, this.remoteName);
      
          // TODO use SEND_START and SEND_STOP for repeatable buttons like volume up / down
          this.lircClient.cmd('SEND_ONCE', this.remoteName, lircKey, function (err) {
            if (err) {
              console.error('ERROR [LIRC] SEND_ONCE failed:', err);
            }
          });
        } else {
            console.warn('WARN  [NEEO] Undefined LIRC key for button name "%s" on %s for remote %s.', name, deviceid, this.remoteName);
        }
    }

 };
