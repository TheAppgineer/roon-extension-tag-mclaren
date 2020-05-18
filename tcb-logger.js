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

function TcbLogger() {
}

TcbLogger.prototype.get_message_string = function(message) {
    if (message.payload) {
        const hdr = '<L>' + message.header;
        const pld = message.payload.join(' ');

        return `${message.source} ${message.dest} ${hdr} ${message.payload.length} [${pld}]`;
    } else {
        const hdr = '<S>' + message.header;

        return `${message.source} ${message.dest} ${hdr}`;
    }
}

module.exports = TcbLogger;
