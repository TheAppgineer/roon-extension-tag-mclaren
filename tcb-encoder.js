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

const STX = 0x02;
const ETX = 0x03;

const MAX_PAYLOAD_SIZE = 150;

const groups = {
    'DVD': 0x01,
    'AVP': 0x02,
    'AMP': 0x03,
    'COD': 0x04,
    'PRE': 0x05,
    'IR_': 0x06,
    'TUN': 0x07,
    'CDR': 0x08,
    'TV_': 0x09,
    'PC_': 0x0A,
    'TRG': 0x0B,
    'CMB': 0x0C,
    'CD_': 0x0D,
    'OSD': 0x0E
};

const short_messages = {
    'ACK':                0x001,
    'NACK':               0x002,
    'NEXT_DEVICE':        0x003,
    'NEXT_DEVICE_ACK':    0x004,
    'GET_AMP_STATUS':     0x006,
    'GET_DEVICE_ID':      0x009,
    'STORE_ADDRESS':      0x00A,
    'RESTART':            0x00B,
    'RESET_ADDRESS':      0x00C,
    'GET_STATUS':         0x00D,
    'GET_NETWORK_STATUS': 0x00E,
    'PONG':               0x7FE,
    'PING':               0x7FF
};

const long_messages = {
    'RADIO_TEXT':     0x001,
    'RC5_CODE':       0x002,
    'POWERUP':        0x003,
    'DEBUG':          0x004,
    'SET_BRIGHTNESS': 0x005,
    'AMP_STATUS':     0x006,
    'ERROR_MSG':      0x007,
    'TRIGGER_EVENTS': 0x008,
    'RC5':            0x009,
    'DEVICE_STATUS':  0x013,
    'GET_PRESETS':    0x014,
    'PRESETS':        0x015,
    'NETWORK_STATUS': 0x016
};

function TcbEncoder() {
}

TcbEncoder.prototype.encode = function(message) {
    const TcbCrc = require('./tcb-crc');
    const tcb_crc = new TcbCrc();
    let data = [];
    let crc = 0;

    _push_address(message.source, data);
    _push_address(message.dest, data);

    if (_push_header(message.header, data) && message.payload.length) {
        if (message.payload.length < MAX_PAYLOAD_SIZE) {
            data.push(message.payload.length);
            data.push(~message.payload.length & 0xFF);

            data = data.concat(message.payload);
        } else {
            // Truncate payload, upper layers should prevent hitting the limit
            data.push(MAX_PAYLOAD_SIZE);
            data.push(~MAX_PAYLOAD_SIZE & 0xFF);

            data = data.concat(message.payload.slice(0, MAX_PAYLOAD_SIZE));
        }
    }

    for (let i = 0; i < data.length; i++) {
        crc = tcb_crc.update_crc(crc, data[i]);
    }
    _push_16bit_value(~crc & 0xFFFF, data);

    // Prepend/append data with start/end byte
    data.unshift(STX);
    data.push(ETX);

    return Buffer.from(data);
}

function _push_address(address_string, data) {
    const address = _encode_address(address_string);

    _push_16bit_value((address.group << 6) | address.device, data);
}

function _push_header(header, data) {
    if (long_messages[header]) {
        _push_16bit_value(long_messages[header] | 0x8000, data);

        return true;
    } else if (short_messages[header]) {
        _push_16bit_value(short_messages[header], data);

        return false;
    }
}

function _encode_address(address_string) {
    if (address_string == 'BRCST') {
        return 0;
    } else {
        return {
            group:  groups[address_string.substring(0, 3)],
            device: parseInt(address_string.substring(3))
        };
    }
}

function _push_16bit_value(value, data) {
    data.push(value >>> 8);
    data.push(value & 0xFF);
}

module.exports = TcbEncoder;
