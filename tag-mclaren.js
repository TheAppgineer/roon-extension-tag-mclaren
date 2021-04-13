// Copyright 2020 The Appgineer
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use strict";

const RoonApi              = require("node-roon-api"),
      RoonApiSettings      = require('node-roon-api-settings'),
      RoonApiStatus        = require('node-roon-api-status'),
      RoonApiSourceControl = require('node-roon-api-source-control'),
      TcbController        = require('./tcb-controller');

var roon = new RoonApi({
    extension_id:        'com.theappgineer.tag-mclaren',
    display_name:        'TAG McLaren Audio Source Control',
    display_version:     '0.1.1',
    publisher:           'The Appgineer',
    email:               'theappgineer@gmail.com',
    website:             'https://github.com/TheAppgineer/roon-extension-tag-mclaren',
    log_level:           'none'
});

var svc_status = new RoonApiStatus(roon);
var svc_source_control = new RoonApiSourceControl(roon);
var tcb_controller;
var ping_interval_timer;

var tma_settings = roon.load_config("settings") || {
};

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        cb(makelayout(tma_settings));
    },
    save_settings: function(req, isdryrun, settings) {
        let l = makelayout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error) {
            tma_settings = l.values;
            svc_settings.update_settings(l);
            roon.save_config("settings", tma_settings);

            if (!tcb_controller && tma_settings.port) {
                init_tcb_controller();
            } else {
                query_device();
            }
        }
    }
});

var source_control = svc_source_control.new_device({
    state: {
        display_name:     'TAG McLaren',
        supports_standby: true,
        status:           'standby'
    },
    convenience_switch: function (req) {
        this.state.status = 'selected';
        if (tma_settings.device) {
            tcb_controller.transmit_rc5(tma_settings.device, 'ON');
        }
        req.send_complete('Success');
        source_control.update_state({ status: this.state.status });
    },
    standby: function (req) {
        this.state.status = 'standby';
        if (tma_settings.device) {
            tcb_controller.transmit_rc5(tma_settings.device, 'STANDBY');
        }
        req.send_complete('Success');
        source_control.update_state({ status: this.state.status });
    }
});

roon.init_services({
    provided_services: [ svc_source_control, svc_settings, svc_status ],
});

function makelayout(settings) {
    let l = {
        values:    settings,
        layout:    [],
        has_error: false
    };

    l.layout.push({
        type:    "string",
        title:   "Serial Port",
        setting: "port"
    });

    l.layout.push({
        type:    "dropdown",
        title:   "Device",
        values:  [
            //{ title: "AV32R/AV192R",        value: "AVP01" },
            { title: "100x5R/250x3R/250MR", value: "AMP01" }
        ],
        setting: "device",
    });

    if (settings.device == 'AMP01') {
        let items = [];

        for (let i = 0; i < 5; i++) {
            items.push({
                type:    'dropdown',
                title:   `Channel ${i + 1}`,
                values:  [
                    { title: 'Disabled', value: 0 },
                    { title: 'Enabled',  value: 1 }
                ],
                setting: 'channel' + i
            });
        }

        items.push({
            type:    'dropdown',
            title:   'LEDs',
            values:  [
                { title: 'Off',               value: 0 },
                { title: 'Low Brightness',    value: 2 },
                { title: 'Medium Brightness', value: 5 },
                { title: 'High Brightness',   value: 7 }
            ],
            setting: 'led'
        });

        l.layout.push({
            type: 'group',
            title: '',
            items
        });
    }

    return l;
}

function log(message, is_error) {
    const date = new Date();

    if (is_error) {
        console.error(date.toISOString(), '- Err:', message);
    } else {
        console.log(date.toISOString(), '- Inf:', message);
    }
}

function query_device() {
    if (tma_settings.device && tcb_controller) {
        tcb_controller.transmit(tma_settings.device, 'GET_DEVICE_ID', process_response);
        tcb_controller.subsribe_to_message(tma_settings.device, 'BRCST', 'POWERUP', process_response);
    }
}

function process_response(err, header, response) {
    if (err) {
        svc_status.set_status('Device not found', true);

        source_control.update_state({ status: 'standby' });

        stop_ping();
    } else {
        switch (header) {
            case 'POWERUP':
                const display_name = `TAG McLaren ${response.product}-v${response.sw_version}`;

                source_control.update_state({ display_name });
                svc_status.set_status('Device found: ' + display_name, false);

                switch (tma_settings.device) {
                    case 'AVP01':
                        tcb_controller.transmit(tma_settings.device, 'GET_STATUS', process_response);
                        break;
                    case 'AMP01':
                        tcb_controller.transmit(tma_settings.device, 'GET_AMP_STATUS', process_response);
                        break;
                }

                start_ping();
                break;
            case 'AMP_STATUS':
                source_control.update_state({ status: (response.status.standby ? 'standby' : 'selected') });

                if (!response.status.standby) {
                    // Setup channels
                    for (let i = 0; i < 5; i++) {
                        const req_state = tma_settings['channel' + i];

                        if (req_state !== undefined && req_state ^ response.status.channels[i]) {
                            tcb_controller.transmit_rc5(tma_settings.device, `CH${i + 1}_${req_state ? 'ON': 'OFF'}`);
                        }
                    }

                    // Setup LED brightness
                    if (tma_settings.led !== undefined) {
                        tcb_controller.transmit(tma_settings.device, 'SET_BRIGHTNESS', [tma_settings.led, 0x01]);
                    }
                }
                break;
            case 'DEVICE_STATUS':
                source_control.update_state({ status: (response.status.standby ? 'standby' : 'selected') });
                break;
        }
    }
}

function start_ping() {
    if (!ping_interval_timer) {
        ping_interval_timer = setInterval(tcb_controller.transmit, 60000, tma_settings.device, 'PING', process_response);
    }
}

function stop_ping() {
    if (ping_interval_timer) {
        clearInterval(ping_interval_timer);
        ping_interval_timer = undefined;
    }
}

function init_tcb_controller() {
    tcb_controller = new TcbController(tma_settings.port, (err) => {
        if (err) {
            svc_status.set_status('Failed to open Serial Port', true);
        } else {
            svc_status.set_status('Serial Port opened', false);

            query_device();
        }
    });
}

function init_signal_handlers() {
    const handle = function(signal) {
        process.exit(0);
    };

    // Register signal handlers to enable a graceful stop of the container
    process.on('SIGTERM', handle);
    process.on('SIGINT', handle);
}

function init() {
    // Complete structures in console logs
    require("util").inspect.defaultOptions.depth = null;

    if (tma_settings.port) {
        init_tcb_controller();
    } else {
        svc_status.set_status('No Serial Port configured in Settings', true);
    }

    init_signal_handlers();
    roon.start_discovery();
}

init();
