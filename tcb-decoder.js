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

const TCB_STX        = 0;
const TCB_SOURCE_MSB = 1;
const TCB_SOURCE_LSB = 2;
const TCB_DEST_MSB   = 3;
const TCB_DEST_LSB   = 4;
const TCB_HEADER_MSB = 5;
const TCB_HEADER_LSB = 6;
const TCB_LENGTH     = 7;
const TCB_LENGTH_INV = 8;
const TCB_PAYLOAD    = 9;
const TCB_CRC_MSB    = 10;
const TCB_CRC_LSB    = 11;
const TCB_ETX        = 12;

const STX = 0x02;
const ETX = 0x03;

const CRC = 0x1D0F;

const group_names = {
    0x00: 'BRCST',
    0x01: 'DVD',
    0x02: 'AVP',
    0x03: 'AMP',
    0x04: 'COD',
    0x05: 'PRE',
    0x06: 'IR_',
    0x07: 'TUN',
    0x08: 'CDR',
    0x09: 'TV_',
    0x0A: 'PC_',
    0x0B: 'TRG',
    0x0C: 'CMB',
    0x0D: 'CD_',
    0x0E: 'OSD'
};

const short_message_names = {
    0x001: 'ACK',
    0x002: 'NACK',
    0x003: 'NEXT_DEVICE',
    0x004: 'NEXT_DEVICE_ACK',
    0x006: 'GET_AMP_STATUS',
    0x009: 'GET_DEVICE_ID',
    0x00A: 'STORE_ADDRESS',
    0x00B: 'RESTART',
    0x00C: 'RESET_ADDRESS',
    0x00D: 'GET_STATUS',
    0x00E: 'GET_NETWORK_STATUS',
    0x7FE: 'PONG',
    0x7FF: 'PING'
};

const long_message_names = {
    0x001: 'RADIO_TEXT',
    0x002: 'RC5_CODE',
    0x003: 'POWERUP',
    0x004: 'DEBUG',
    0x005: 'SET_BRIGHTNESS',
    0x006: 'AMP_STATUS',
    0x007: 'ERROR_MSG',
    0x008: 'TRIGGER_EVENTS',
    0x009: 'RC5',
    0x013: 'DEVICE_STATUS',
    0x014: 'GET_PRESETS',
    0x015: 'PRESETS',
    0x016: 'NETWORK_STATUS'
};

function TcbDecoder(cb) {
    this.state = TCB_STX;
    this.message;
    this.on_message = cb;
    this.synced = true;
}

TcbDecoder.prototype.feed = function(data) {
    const TcbCrc = require('./tcb-crc');
    const tcb_crc = new TcbCrc();

    for (let i = 0; i < data.length; i++) {
        if (this.state != TCB_STX && this.state != TCB_ETX) {
            this.message.crc = tcb_crc.update_crc(this.message.crc, data[i]);
        }

        switch (this.state) {
            case TCB_STX:
                if (data[i] === STX) {
                    if (this.synced === false) {
                        console.log("sync'ed")
                        this.synced = true;
                    }
                    this.message = { crc: 0 };
                    this.state = TCB_SOURCE_MSB;
                }
                break;
            case TCB_SOURCE_MSB:
                this.message.source = data[i] << 8;
                this.state = TCB_SOURCE_LSB;
                break;
            case TCB_SOURCE_LSB:
                this.message.source |= data[i];
                this.state = TCB_DEST_MSB;
                break;
            case TCB_DEST_MSB:
                this.message.dest = data[i] << 8;
                this.state = TCB_DEST_LSB;
                break;
            case TCB_DEST_LSB:
                this.message.dest |= data[i];
                this.state = TCB_HEADER_MSB;
                break;
            case TCB_HEADER_MSB:
                this.message.header = data[i] << 8;
                this.state = TCB_HEADER_LSB;
                break;
            case TCB_HEADER_LSB:
                this.message.header |= data[i];
                if (this.message.header & 0x8000) {
                    this.state = TCB_LENGTH;
                } else {
                    this.state = TCB_CRC_MSB;
                }
                break;
            case TCB_LENGTH:
                this.message.length = data[i];
                this.state = TCB_LENGTH_INV;
                break;
            case TCB_LENGTH_INV:
                if ((this.message.length ^ data[i]) === 0xFF) {
                    this.state = TCB_PAYLOAD;
                    this.message.payload = [];
                } else {
                    // Length mismatch, try to sync again
                    console.log('lost sync');
                    this.synced = false;
                    this.state = TCB_STX;
                }
                break;
            case TCB_PAYLOAD:
                this.message.payload.push(data[i]);

                if (this.message.payload.length == this.message.length) {
                    this.state = TCB_CRC_MSB;
                }
                break;
            case TCB_CRC_MSB:
                this.state = TCB_CRC_LSB;
                break;
            case TCB_CRC_LSB:
                if (this.message.crc == CRC) {
                    this.state = TCB_ETX;
                } else {
                    // CRC mismatch, try to sync again
                    console.log('lost sync');
                    this.synced = false;
                    this.state = TCB_STX
                }
                break;
            case TCB_ETX:
                if (data[i] === ETX) {
                    // Perform some basic processing
                    this.message.source = _process_raw_address(this.message.source);
                    this.message.dest = _process_raw_address(this.message.dest);
                    this.message.header = _process_raw_header(this.message.header);
                    delete this.message.length;
                    delete this.message.crc;

                    this.on_message && this.on_message(this.message);
                }
                this.state = TCB_STX;
                break;
        }
    }
}

function _process_raw_address(address) {
    const device = address & 0x3F;
    const group = (address >>> 6) & 0x3F;
    let address_string = '';

    if (group_names[group]) {
        address_string += group_names[group];

        if (group) {
            // Append device number
            if (device < 10) {
                address_string += '0';
            }
            address_string += device;
        }
    }

    return address_string;
}

function _process_raw_header(header) {
    const is_long = (header & 0x8000 ? true : false);

    return (is_long ? long_message_names[header & 0x7FF] : short_message_names[header & 0x7FF]);
}

module.exports = TcbDecoder;
