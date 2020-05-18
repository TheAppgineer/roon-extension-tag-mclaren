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

const response_headers = {
    'GET_AMP_STATUS': 'AMP_STATUS',
    'GET_DEVICE_ID':  'POWERUP',
    'GET_STATUS':     'DEVICE_STATUS',
    'PING':           'PONG'
};

const rc5 = {
    'AVP': {
        'ON':      [19, 120, 0],
        'STANDBY': [19, 121, 0]
    },
    'AMP': {
        'CH1_ON':  [16, 101, 0],
        'CH1_OFF': [16, 102, 0],
        'CH2_ON':  [16, 103, 0],
        'CH2_OFF': [16, 104, 0],
        'CH3_ON':  [16, 105, 0],
        'CH3_OFF': [16, 106, 0],
        'CH4_ON':  [16, 107, 0],
        'CH4_OFF': [16, 108, 0],
        'CH5_ON':  [16, 109, 0],
        'CH5_OFF': [16, 110, 0],
        'STANDBY': [16, 111, 0],
        'ON':      [16, 112, 0]
    }
};

const MY_ADDRESS = 'PC_01';
const MAX_AMP_CHANNELS = 5;

const CH_OFF = 0;
const CH_ON = 1;
const CH_MUTE = 2;

const SerialPort = require('serialport'),
      ByteLength = require('@serialport/parser-byte-length'),
      TcbLogger  = require('./tcb-logger'),
      TcbEncoder = require('./tcb-encoder'),
      TcbDecoder = require('./tcb-decoder');

const tcb_encoder = new TcbEncoder();
const tcb_logger = new TcbLogger();

var serialport;
var msg_queue = [];
var sub_queue = [];
var bus_control = {};

function TcbController(port, cb) {
    const tcb_decoder = new TcbDecoder((message) => {
        console.log(tcb_logger.get_message_string(message));

        // Response handling
        if (message_is_reponse(message, bus_control.response)) {
            clearTimeout(bus_control.response_timer);

            if (bus_control.cb) {
                bus_control.cb(undefined, message.header, _decode_payload(message));
            }

            if (msg_queue.length) {
                _start_bus_idle_timer();
            }
        }

        // Subscription handling
        for (let i = 0; i < sub_queue.length; i++) {
            if (message_is_reponse(message, sub_queue[i].response) && sub_queue[i].cb) {
                sub_queue[i].cb(undefined, message.header, _decode_payload(message));
                break;
            }
        }
    });

    serialport = new SerialPort(port, { baudRate: 115200 });

    serialport.on('open', (err) => {
        if (err) {
            console.error(err);
        } else {
            console.log(`Serial port "${port}" opened`);
        }

        cb && cb(err);
    });

    const parser = serialport.pipe(new ByteLength({ length: 1 }));

    parser.on('data', data => {
        _reset_bus_idle_timer();
        tcb_decoder.feed(data);
    });
}

TcbController.prototype.transmit_rc5 = function(dest, code) {
    const group = dest.substring(0, 3);
    let payload;

    if (rc5[group] && rc5[group][code]) {
        payload = rc5[group][code];
    }

    if (payload.length) {
        TcbController.prototype.transmit.call(this, dest, 'RC5', payload);
    }
}

TcbController.prototype.transmit = function(dest, msg_id, payload, cb) {
    let message = {};

    if (payload) {
        if (Array.isArray(payload)) {
            message.payload = payload;
        } else if (!cb) {
            cb = payload;
        }
    }

    message.source = MY_ADDRESS;
    message.dest = dest;
    message.header = msg_id;

    msg_queue.push({ message, cb });
    _start_bus_idle_timer();
}

TcbController.prototype.subsribe_to_message = function(src, dest, msg_id, cb) {
    let response = {};

    response.source = src;
    response.dest = dest;
    response.header = msg_id;

    sub_queue.push({ response, cb });
}

function _start_bus_idle_timer() {
    // Only if timer isn't running yet
    if (bus_control.idle_timer === undefined) {
        bus_control.idle_timer = setTimeout(_send_next_message, 50);
    }
}

function _reset_bus_idle_timer() {
    // Only if timer is running
    if (bus_control.idle_timer) {
        clearTimeout(bus_control.idle_timer);
        bus_control.idle_timer = setTimeout(_send_next_message, 50);
    }
}

function _send_next_message() {
    bus_control.idle_timer = undefined;

    // Take control over the bus
    if (msg_queue.length) {
        if (serialport && serialport.isOpen) {
            const msg = msg_queue.shift();
            const response_header = response_headers[msg.message.header];

            console.log(tcb_logger.get_message_string(msg.message));

            if (response_header) {
                const response = {
                    source: msg.message.dest,
                    dest: msg.message.source,
                    header: response_header
                };

                bus_control.message = msg.message;
                bus_control.response = response;
                bus_control.response_timer = setTimeout(_retry, 30);
                bus_control.retries = 3;
                bus_control.cb = msg.cb;
            } else {
                bus_control.response = undefined;
            }

            serialport.write(tcb_encoder.encode(msg.message), (err) => {
                if (err) {
                    console.error(err);
                }

                if (!response_header && msg_queue.length) {
                    _start_bus_idle_timer();
                }
            });
        } else {
            // Try again later
            _start_bus_idle_timer();
        }
    }
}

function _retry() {
    if (bus_control.retries--) {
        console.log(tcb_logger.get_message_string(bus_control.message));

        serialport.write(tcb_encoder.encode(bus_control.message), (err) => {
            if (err) {
                console.error(err);
            }

            bus_control.response_timer = setTimeout(_retry, 30);
        });
    } else if (bus_control.cb) {
        bus_control.cb('No response');
    }
}

function message_is_reponse(message, response) {
    return (response      !== undefined       &&
            message.source == response.source &&
            message.dest   == response.dest   &&
            message.header == response.header);
}

function _decode_payload(message) {
    const product = {
         0: 'PC',
        77: 'DPA32R', 
        78: 'DVD32R',
        79: '100x5R',
        80: 'Cleopatra',
        81: 'Aphrodite',
        82: 'T32R',
        83: 'AV32R'
    };
    let result = {};

    switch (message.header) {
        case 'POWERUP':
            result.tcb_version = `${message.payload[1]}.${message.payload[0]}`;
            result.product = product[message.payload[2]];
            result.sw_version = `${message.payload[5]}.${message.payload[4]}`;
            break;
        case 'DEVICE_STATUS':
            result.product = product[message.payload[0]];
            result.status = {
                standby: (message.payload[2] & 0x01 ? true : false),
                mute:    (message.payload[2] & 0x02 ? true : false)
            };
            break;
        case 'AMP_STATUS':
            let standby = true;
            let mute = false;
            let channels = [];
            
            for (let i = 0; i < MAX_AMP_CHANNELS; i++) {
                channels.push(message.payload[i] === CH_OFF ? 0 : 1);

                if (message.payload[i] !== CH_OFF) {
                    standby = false;

                    if (message.payload[i] === CH_MUTE) {
                        mute = true;
                    }
                }
            }

            if (standby) {
                //  All channels off, force standby
                TcbController.prototype.transmit_rc5.call(this, message.source, 'STANDBY');
            }

            result.status = {
                standby,
                mute,
                channels
            };
            break;
    }

    return result;
}

module.exports = TcbController;
