(function(window){
    // used only in case of debugging
    let DISABLE_ENCRYPTION = false;

    let initialDate = new Date();
    let requests = 0;
    const requests_limit = 50;
    const requests_time_period = 1500;
    const DEFAULT_RECEIVE_LIMIT = 50;

    let xhr_enabled = true;
    const channelPasswordRegex = /[*,\/\\\s]+/;

    "use strict";

    const MySecurity =  {

        encrypt : function($plain,$key){
            if(typeof $plain === 'object'){
                $plain = JSON.stringify($plain);
            }
            return AesCtr.encrypt($plain, $key, 128).replace(/[\0]+/g,'');
        },

        decrypt : function ($cipher,$key){
            try{
                return AesCtr.decrypt($cipher, $key, 128).replace(/[\0]+/g,'');
            }catch(err){
                console.log(err);
            }
        },
        encryptAndSign : function ($message, $key){
            if(typeof $message === 'object'){
                $message = JSON.stringify($message);
            }
            const $myObj = {};
            $myObj.cipher = this.encrypt($message, $key);
            $myObj.hash = this.hash($message, $key);
            return JSON.stringify($myObj);
        },

        // RSA helpers
        // Generate RSA-OAEP keypair and export public key PEM; returns { publicKeyPem, privateKey }
        rsaGenerate: async function(){
            return await generateRsaKeyPair();
        },

        // Encrypt plaintext (string) with a PEM public key (SPKI) using RSA-OAEP; returns base64 ciphertext
        rsaEncrypt: async function(publicKeyPem, plaintext){
            return await encryptWithPemOaep(publicKeyPem, plaintext);
        },

        // Decrypt a base64 ciphertext produced by rsaEncrypt using a CryptoKey privateKey (RSA-OAEP)
        // returns decrypted UTF-8 string
        rsaDecrypt: async function(privateKeyCryptoKey, base64Cipher){
            if(!privateKeyCryptoKey || !base64Cipher){
                throw new Error('privateKey and base64Cipher are required');
            }
            const raw = Uint8Array.from(atob(base64Cipher), c => c.charCodeAt(0));
            const plainBuf = await window.crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKeyCryptoKey, raw);
            return new TextDecoder().decode(plainBuf);
        },

        hash: (value, key) =>  {
            return CryptoJS.HmacSHA256(value, key).toString(CryptoJS.enc.Hex);
            //return CryptoJS.SHA256(value).toString(CryptoJS.enc.Hex)
        },

        decryptAndVerify : function ($cipherMsg, $key){
            try{
                if(typeof $cipherMsg === 'string'){
                    $cipherMsg = JSON.parse($cipherMsg);
                }

                const $message = this.decrypt($cipherMsg.cipher, $key);

                if(this.hash($message, $key) !== $cipherMsg.hash){
                    return null;
                } else {
                    return $message;
                }
            }catch(err){
                console.log(err);
            }
        },

        deriveChannelSecret: async function (channelName, password) {

            const combined = channelName + password;
            const enc = new TextEncoder();

            // Import raw input
            const keyMaterial = await crypto.subtle.importKey(
                "raw",
                enc.encode(combined),
                { name: "PBKDF2" },
                false,
                ["deriveBits"]
            );

            // Derive 256-bit key
            const derivedBits = await crypto.subtle.deriveBits(
                {
                    name: "PBKDF2",
                    salt: enc.encode("messaging-platform"),
                    iterations: 100000,
                    hash: "SHA-256"
                },
                keyMaterial,
                256
            );

            // Convert to Base64
            const bytes = new Uint8Array(derivedBits);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            let base64 = btoa(binary);

            return 'channel_' + base64.replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
        }

    }

    function parsefileName(fileNameUrl){
        if(fileNameUrl){
            fileNameUrl = fileNameUrl.replace(/\\/g,'/').replace(/\/$/,'')
            let index = fileNameUrl.length-1
            while(index >=0 && fileNameUrl.charAt(index) !== '/'){
                index --;
            }

            return fileNameUrl.substring(index+1);
        }
    }

    function rangeNumber(num) {
        num = parseInt(num);
        return (isNaN(num) || !isFinite(num)) ? Infinity : num;
    }

    function parseRange(range){

        if (typeof range === 'object')
        {
            return range;
        }

        let seperator = range.indexOf(':') !== -1 ? ':' : '-'
        let start,change,end;
        const parts = range.split(seperator);
        if(parts.length >= 3){
            start = rangeNumber(parts[0]);
            change = rangeNumber(parts[1]);
            end = rangeNumber(parts[2]);
        }else{
            start = rangeNumber(parts[0]);
            end = rangeNumber(parts[1]);
        }

        if(start > end){
            const temp = start;
            start = end;
            end = temp;
        }

        return {start, change, end};
    }

    function guid8() {
        function s4() {
            return Math.floor((1 + Math.random()) * 0x10000)
                .toString(16)
                .substring(1);
        }

        let str = '';

        for(let i=0;i<4;i++){
            str = str + '' + s4();
        }

        return str;
    }

    function guid16() {
        function s4() {
            return Math.floor((1 + Math.random()) * 0x10000)
                .toString(16)
                .substring(1);
        }

        let str = '';

        for(let i=0;i<8;i++){
            str = str + '' + s4();
        }

        return str;
    }

    function guid32() {
        return guid16()+''+guid16();
    }

    function getPublicKey(obj){

        if(!xhr_enabled){
            return;
        }

        const xhrHandler = function(){
            let response;

            if(xhr.status === 200){
                response = {status : 'success',data : this.response};
            }else{
                response = {status : 'error',data : this.response};
            }

            typeof obj.callback === 'function' && obj.callback(response);
        }

        const xhr = new XMLHttpRequest();

        xhr.addEventListener('load', xhrHandler);
        xhr.addEventListener('error', function(err){
            const response = {status : 'error', data : this.response};
            typeof obj.callback === 'function' && obj.callback(response);
        });


        xhr.open('get',  getActionUrl(obj.base, false, 'public_key.php'), true);

        // Set API key header if provided (supports custom header name)
        if(obj.apiKey){
            xhr.setRequestHeader('X-Api-Key', obj.apiKey);
        }

        xhr.send();

    }

    // Utility: generate RSA-OAEP keypair and return { publicKeyPem, privateKey }
    async function generateRsaKeyPair() {
        const keyPair = await window.crypto.subtle.generateKey(
            { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
            true,
            ["encrypt", "decrypt"]
        );

        const spki = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
        const b64 = window.btoa(String.fromCharCode.apply(null, new Uint8Array(spki)));
        const pem = '-----BEGIN PUBLIC KEY-----\n' + b64.replace(/(.{64})/g,'$1\n') + '\n-----END PUBLIC KEY-----\n';

        return { publicKeyPem: pem, privateKey: keyPair.privateKey };
    }

    // Utility: encrypt a UTF-8 string with a PEM public key using RSA-OAEP and return base64
    // Note: the PEM import logic was in a separate helper; it's inlined here to keep the
    // import and encrypt flow together. A backwards-compatible alias `rsaEncryptWithPem`
    // is provided.
    async function encryptWithPemOaep(pem, plaintext) {
        // Inline PEM -> CryptoKey conversion (SPKI)
        const pemHeader = '-----BEGIN PUBLIC KEY-----';
        const pemFooter = '-----END PUBLIC KEY-----';
        let b64 = pem.replace(pemHeader, '').replace(pemFooter, '').replace(/\s+/g, '');
        const binary = atob(b64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        const pubKey = await window.crypto.subtle.importKey(
            'spki',
            bytes.buffer,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            false,
            ['encrypt']
        );

        const enc = new TextEncoder();
        const data = enc.encode(plaintext);
        const cipherBuf = await window.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, data);
        const bytesOut = new Uint8Array(cipherBuf);
        let binaryOut = '';
        for (let i = 0; i < bytesOut.byteLength; i++) {
            binaryOut += String.fromCharCode(bytesOut[i]);
        }
        return btoa(binaryOut);
    }

    // Backwards-compatible alias; some callers expect rsaEncryptWithPem name
    async function rsaEncryptWithPem(pem, plaintext) {
        return encryptWithPemOaep(pem, plaintext);
    }

    function reset(obj){
        requests = 0;
        xhr_enabled = false;
        setTimeout(function(){
            xhr_enabled = true;
        },5000);
        console.log('Something went wrong, you can try to connect after 5 seconds or you can use channel.onreset function');
    }

    function getActionUrl(url, pubkeyMode, action){
        let baseUrl = url;
        if(!baseUrl){
            baseUrl = '';
        }
        else if(baseUrl.endsWith('/'))
        {
            baseUrl = baseUrl.substring(0, baseUrl.length - 1);
        }
        return `${baseUrl}/${action}?use-pubkey=${pubkeyMode}`;
    }

    /**
     * Helper for constructing storage REST endpoint URLs
     * Storage endpoints don't use the use-pubkey query parameter
     * @param {string} apiBase - Base API URL (e.g., 'https://example.com/messaging-platform/api/v1/messaging-service')
     * @param {string} endpoint - Storage endpoint (e.g., 'put', 'get', 'keys')
     * @returns {string} Full URL for storage endpoint
     */
    function getStorageUrl(apiBase, endpoint){
        let baseUrl = apiBase;
        if(!baseUrl){
            baseUrl = '';
        }
        else if(baseUrl.endsWith('/'))
        {
            baseUrl = baseUrl.substring(0, baseUrl.length - 1);
        }
        return `${baseUrl}/storage/${endpoint}`;
    }

    function preparePayload(payload, pubKeyEncryptor){
        if(payload){

            if(typeof payload === 'object'){
                payload = JSON.stringify(payload);
            }else{
                payload = payload.toString();
            }

            if (pubKeyEncryptor)
            {
                let cipher = '';

                for(let i=0;i<payload.length;i+=200){
                    cipher += pubKeyEncryptor.encrypt(payload.substring(i,i+200));
                }
                payload = cipher;
            }

        }else{
            payload = undefined;
        }

        return payload;
    }

    function abortRequest(xhr){
        if(xhr){
            xhr._dont_use_callback = true;
            try{
                xhr.abort();
            }catch(err){
                console.log(err);
            }
        }
    }

    function request(obj , binData){

        if(!xhr_enabled){
            return;
        }

        if(typeof obj.retryChances !== 'number'){
            obj.retryChances = 1;
        }

        obj.retryChances--;

        const newDate = new Date();

        if((newDate - initialDate) < requests_time_period){
            requests++;
        }else{
            requests = 0;
            initialDate = new Date();
        }

        if(requests > requests_limit){
            return reset(obj,binData);
        }

        let method = obj.method || 'get';
        method = method.toLowerCase();

        const action = obj.action;

        if(!action){
            throw new Error("action parameter is required");
        }

        let payload = (obj.payload != null && obj.payload) || undefined;

        const callback = obj.callback;

        const xhr = new XMLHttpRequest();

        const timeout = parseInt(obj.timeout);

        if(!obj.useSyncMode && !isNaN(timeout) && timeout > 0){
            xhr.timeout = timeout;//10 * 60 * 1000
        }

        let handled = false;
        const xhrHandler = function(){
            if(handled){
                return;
            }else{
                handled = true;
            }

            if(xhr._dont_use_callback){
                return;
            }

            let response;

            if(xhr.status === 200){
                response = {status : 'success',data : this.response};
                typeof callback === 'function' && callback(response);
            }else{

                if(obj.retryChances <=0){
                    response = {status : 'error',data : this.response};
                    typeof callback === 'function' && callback(response);
                }else{
                    request(obj,binData);
                }
            }

        }

        //xhr.onabort = xhrHandler;
        xhr.onloadend = xhrHandler;
        //xhr.ontimeout = xhrHandler;
        //xhr.onerror = xhrHandler;
        //xhr.onreadystatechange = function () {
        //	this.readyState > 3 && xhrHandler.apply(this,arguments);
        //};

        payload = preparePayload(payload, obj.pubKeyEncryptor);

        let url;

        if(method === 'get' || binData){
            url = getActionUrl(obj.base, !!obj.pubKeyEncryptor, action) + (payload ? `&data=${encodeURIComponent(payload)}` : "") //, !obj.useSyncMode;
            console.log('url is ', url)
            payload = method === 'get'? binData : undefined;
        }else{
            url = getActionUrl(obj.base, !!obj.pubKeyEncryptor, action) //, !obj.useSyncMode;
        }

        xhr.open(method, url);
        xhr.setRequestHeader("Content-Type", "application/json");

        // Set API key header if provided (supports custom header name)
        if(obj.apiKey){
            xhr.setRequestHeader('X-Api-Key', obj.apiKey);
        }

        if(binData){
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.send(new Uint8Array(binData));
        }else{
            xhr.send(payload);
        }


        return xhr;
    }

    const FileSystem = function FileSystem(channel){
        this.channel = channel;
        this.fileChunkSize  = 200 * 1024; // 200Kbyte chunks
    }

    FileSystem.prototype.list = function(rootDir,callback){

        const _self = this.channel;
        if(!rootDir){
            throw new Error('rootDir object is required');
        }

        if(!_self.readyState || !_self.sessionId){
            return typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
        }

        const session = _self.sessionId;

        const payload = {
            root : rootDir,
            type: 'file-list',
            to : _self._agentName,
            encrypted : false,
            content : '',
            sessionId : session
        };

        console.log('Sending payload : ');
        console.log(payload);

        request({
            useSyncMode : _self.useSyncMode,
            base : _self._api,
            pubKeyEncryptor:_self._pubKeyEncryptor,
            apiKey: _self._apiKey,
            method : 'post',
            action : 'push',
            payload : payload,
            //timeout : 10 * 60 * 1000,
            id : _self.channelId,
            callback : function(e){
                if(e.status === 'success'){
                    e.data = JSON.parse(e.data);
                }

                typeof callback === 'function' && callback(e);

            },
            retryChances : 1
        });
    }

    FileSystem.prototype.getDownloadLink = function(filename){

        const _self = this.channel;

        const payload = preparePayload({
            filename : filename,
            type: 'file-get',
            sessionId : _self.sessionId
        },_self._pubKeyEncryptor);

        return `${getActionUrl(_self._api, false, 'push')}&data=${encodeURIComponent(payload)}`;
    }

    FileSystem.prototype.download = function(filename){

        const _self = this.channel;

        if(!filename){
            throw new Error('filename object is required');
        }

        if(!_self.readyState || !_self.sessionId){
            throw new Error('The channel is not ready.');
        }

        const a = document.createElement('a');
        a.href = this.getDownloadLink(filename);
        a.download = parsefileName(filename);
        console.log('download from : '+a.href)
        const el = document.body.appendChild(a);
        a.click();
        document.body.removeChild(el);
    }

    FileSystem.prototype.mkdir = function(filename,callback){

        const _self = this.channel;

        if(!filename){
            throw new Error('folder name/path is required');
        }

        if(!_self.readyState || !_self.sessionId){
            return typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
        }

        const session = _self.sessionId;

        const payload = {
            filename : filename,
            type: 'file-mkdir',
            to : _self._agentName,
            encrypted : false,//agents encryption is disabled
            content : '',
            sessionId : session
        };

        request({
            useSyncMode : _self.useSyncMode,
            base : _self._api,
            pubKeyEncryptor: _self._pubKeyEncryptor,
            apiKey: _self._apiKey,
            method : 'post',
            action : 'push',
            payload : payload,
            //timeout : 10 * 60 * 1000,
            id : _self.channelId,
            callback : callback,
            retryChances : 1
        });

    }

    FileSystem.prototype.delete = function(filename,callback){

        const _self = this.channel;

        if(!filename){
            throw new Error('file object is required');
        }

        if(!_self.readyState || !_self.sessionId){
            return typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
        }

        const session = _self.sessionId;

        const payload = {
            filename : filename,
            type: 'file-delete',
            to : _self._agentName,
            encrypted : false,//agents encryption is disabled
            content : '',
            sessionId : session
        };

        console.log('Sending payload : ');
        console.log(payload);

        request({
            useSyncMode : _self.useSyncMode,
            base : _self._api,
            pubKeyEncryptor: _self._pubKeyEncryptor,
            apiKey: _self._apiKey,
            method : 'post',
            action : 'push',
            payload : payload,
            //timeout : 10 * 60 * 1000,
            id : _self.channelId,
            callback : callback,
            retryChances : 1
        });

    }

    FileSystem.prototype.put = function(file,putFileName,callback){

        const _self = this.channel;

        if(_self._put_xhr){
            const fileSystem = this;
            _self._put_xhr.abort();
            _self._put_xhr_cancel = true;
            const args = arguments;
            return setTimeout(function(){
                _self._put_xhr = null;
                _self._put_xhr_cancel = false;
                fileSystem.put.apply(fileSystem,args);
            },1500);
        }

        if(!file || !file.name || !putFileName){
            throw new Error('file object and putFileName are required');
        }

        if(!_self.readyState || !_self.sessionId){
            return typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
        }

        const session = _self.sessionId;

        const fd = new FileReader();
        const fileSize   = file.size;
        const chunkSize  = this.fileChunkSize;
        let offset = 0;
        let append = false;

        return new Promise(function(resolve,reject){
            read();
            function read(xhrResponse){
                if(_self._put_xhr_cancel){
                    return;
                }
                if(fd.readyState === 1){
                    console.log('File reader is busy, waiting ...');
                    return setTimeout(read,500);
                }
                xhrResponse = xhrResponse || {status : 'success'};
                const res = {done : false,file : file, path : putFileName};

                if (offset >= fileSize) {
                    res.done = true;
                    res.progress = 100;
                    resolve(res)
                    typeof callback === 'function' && callback(res);
                }else{

                    if(xhrResponse.status === 'error'){
                        reject(xhrResponse);
                        return typeof callback === 'function' && callback(xhrResponse);
                    }

                    const subFile = file.slice(offset, offset + chunkSize);

                    fd.onloadend = fd.onloadend || function(evt){

                        const append = offset !== 0;
                        let readData,dataLength;
                        if (evt.target.error === null) {
                            readData  = evt.target.result;
                            dataLength = readData.length || readData.byteLength;

                            res.data = {length : dataLength};
                            res.progress = 100 * (offset/fileSize);
                            res.status = 'success';
                            res.progress > 0 && typeof callback === 'function' && callback(res);

                            //update next offset
                            offset += dataLength;

                            const payload = {
                                append : append,
                                filename : putFileName,
                                type: 'file-put',
                                to : _self._agentName,
                                encrypted : false,//agents encryption is disabled
                                content : 'binary',//MySecurity.encryptAndSign(res.data,_self._channel_password),
                                sessionId : session
                            };
                            _self._put_xhr = request({
                                useSyncMode : _self.useSyncMode,
                                base : _self._api,
                                pubKeyEncryptor: _self._pubKeyEncryptor,
                                apiKey: _self._apiKey,
                                method : 'post',
                                action : 'push',
                                payload : payload,
                                //timeout : 10 * 60 * 1000,
                                id : _self.channelId,
                                callback : function(e){
                                    if(_self._put_xhr_cancel || !e || e.status !== 'success'){
                                        throw new Error(JSON.stringify(e));
                                    }
                                    requestAnimationFrame(read);
                                    //setTimeout(read,100);
                                    //read();
                                },
                                retryChances : 3
                            },readData);

                        } else {
                            res.status = 'error';
                            res.progress = 0;
                            res.data = evt.target.error;
                            reject(res);
                            return typeof callback === 'function' && callback(res);
                        }
                    }
                    fd.readAsArrayBuffer(subFile);

                }
            }
        });
    }

    const extractApiResponse  = function(response)
    {
        let responseData = response.data;

        if(typeof responseData !== 'object') {
            responseData = JSON.parse(responseData);
        }
        return responseData;
    }

    const AgentConnection = function({usePubKey = false, enableWebrtcRelay = false, useWebsocket = false} = {}){

        this.agentName = null;
        this._connectedAgentsMap = {};  // Map agentName -> AgentInfo object (includes connectionTime)
        this.connectedAgents = [];

        this.fileSystem = new FileSystem(this);

        this.onreset = null;
        this.onconnect = null;
        this.ondisconnect = null;
        this.onmessage = null;
        // Optional hook: function(channelId, requesterAgentName, requesterPublicKeyPem) -> boolean
        // If returns true, Channel will auto-reply with PASSWORD_REPLY when it has channel creds.
        this.onPasswordRequest = null;
        this.onWebRtcSignaling = null;
        this.usePubKey = usePubKey;

        // Enable/disable WebRTC relay creation when connecting to a channel
        this.enableWebrtcRelay = enableWebrtcRelay;

        // WebSocket support for real-time push/pull
        this.useWebsocket = useWebsocket;
        this._websocket = null;
        this._websocketConnected = false;
        this._websocketReconnectAttempts = 0;
        this._websocketMessageCallbacks = new Map();
        this._websocketMessageId = 0;

        // Store initial receive config from connect response
        this.initialReceiveConfig = null;

        // ICE servers for WebRTC (STUN/TURN) - populated from connect response
        this.iceServers = null;

        // Track agent connection timing (from creation to ready state)
        this._agentCreationTime = null;

        // Default poll source for receive operations
        this.defaultPollSource = 'AUTO';

    }

    AgentConnection.prototype.getActiveAgents = function(callback){

        const _self = this;

        if(!_self.readyState){
            throw new Error('Channel is not ready.');
        }

        const session = _self.sessionId;

        request({
            useSyncMode : _self.useSyncMode,
            pubKeyEncryptor : _self._pubKeyEncryptor,
            base : _self._api,
            apiKey: _self._apiKey,
            method : 'post',
            action : 'list-agents',
            payload : {
                sessionId : session
            },
            //timeout : 10 * 60 * 1000,
            id : _self.channelId,
            callback : function(response){
                if(response.status === 'success') {
                    const apiResponse = extractApiResponse(response);
                    typeof callback === 'function' && callback(apiResponse);
                }else{
                    typeof callback === 'function' && callback(response);
                }
            }
        });

    }

    /**
     * Connect to WebSocket for real-time messaging
     * @private
     */
    AgentConnection.prototype._connectWebSocket = function() {
        const _self = this;

        if (_self._websocket && _self._websocket.readyState === WebSocket.OPEN) {
            console.log('[WebSocket] Already connected');
            return;
        }

        // Build WebSocket URL from HTTP API URL
        let wsUrl = _self._api;
        if (wsUrl.startsWith('http://')) {
            wsUrl = 'ws://' + wsUrl.substring(7);
        } else if (wsUrl.startsWith('https://')) {
            wsUrl = 'wss://' + wsUrl.substring(8);
        }
        // Append /ws endpoint
        wsUrl = wsUrl.replace(/\/$/, '') + '/ws';

        console.log('[WebSocket] Connecting to:', wsUrl);

        try {
            _self._websocket = new WebSocket(wsUrl);

            _self._websocket.onopen = function() {
                console.log('[WebSocket] Connected');
                _self._websocketConnected = true;
                _self._websocketReconnectAttempts = 0;

                // Subscribe to receive messages for this session
                _self._websocketSubscribe();
            };

            _self._websocket.onmessage = function(event) {
                try {
                    const message = JSON.parse(event.data);
                    _self._handleWebSocketMessage(message);
                } catch (e) {
                    console.error('[WebSocket] Failed to parse message:', e);
                }
            };

            _self._websocket.onclose = function(event) {
                console.log('[WebSocket] Disconnected:', event.code, event.reason);
                _self._websocketConnected = false;
                _self._websocket = null;

                // Attempt reconnect if still connected to channel
                if (_self.readyState && _self._websocketReconnectAttempts < 5) {
                    _self._websocketReconnectAttempts++;
                    const delay = Math.min(1000 * Math.pow(2, _self._websocketReconnectAttempts), 30000);
                    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${_self._websocketReconnectAttempts})`);
                    setTimeout(() => _self._connectWebSocket(), delay);
                }
            };

            _self._websocket.onerror = function(error) {
                console.error('[WebSocket] Error:', error);
            };
        } catch (e) {
            console.error('[WebSocket] Failed to connect:', e);
        }
    };

    /**
     * Subscribe to WebSocket for receiving messages
     * @private
     */
    AgentConnection.prototype._websocketSubscribe = function() {
        const _self = this;

        if (!_self._websocket || _self._websocket.readyState !== WebSocket.OPEN) {
            console.warn('[WebSocket] Not connected, cannot subscribe');
            return;
        }

        // Note: No API key needed - sessionId provides authenticated context
        const subscribeMessage = {
            action: 'subscribe',
            sessionId: _self.sessionId,
            offset: _self._last_receive_range ? _self._last_receive_range.globalOffset : 0
        };

        _self._websocket.send(JSON.stringify(subscribeMessage));
        console.log('[WebSocket] Subscribed to session:', _self.sessionId);
    };

    /**
     * Handle incoming WebSocket message
     * @private
     */
    AgentConnection.prototype._handleWebSocketMessage = function(message) {
        const _self = this;
        const action = message.action;

        console.debug('[WebSocket] Received:', action, message);

        switch (action) {
            case 'subscribed':
                console.log('[WebSocket] Subscription confirmed for channel:', message.channelId);
                break;

            case 'message':
                // New messages pushed from server
                if (message.status === 'success' && message.data) {
                    _self._processReceivedMessages(message);
                }
                break;

            case 'pull':
                // Response to pull request
                _self._handleWebSocketResponse(message);
                break;

            case 'push':
                // Response to push request
                _self._handleWebSocketResponse(message);
                break;

            case 'pong':
                // Heartbeat response
                break;

            case 'error':
                console.error('[WebSocket] Server error:', message.statusMessage);
                break;

            default:
                console.debug('[WebSocket] Unknown action:', action);
        }
    };

    /**
     * Handle WebSocket response to a request
     * @private
     */
    AgentConnection.prototype._handleWebSocketResponse = function(message) {
        const _self = this;

        // Check for pending callback
        const messageId = message.messageId;
        if (messageId && _self._websocketMessageCallbacks.has(messageId)) {
            const callback = _self._websocketMessageCallbacks.get(messageId);
            _self._websocketMessageCallbacks.delete(messageId);
            callback(message);
        }
    };

    /**
     * Process received messages (from WebSocket push)
     * @private
     */
    AgentConnection.prototype._processReceivedMessages = function(response) {
        const _self = this;

        let data = response.data || {};
        const itemsArray = data.events || [];
        const ephemeralArray = data.ephemeralEvents || [];
        const dataArray = [];

        // Process both normal events and ephemeral events
        const allItems = [...itemsArray, ...ephemeralArray];

        for (let i = 0; i < allItems.length; i++) {
            let item = allItems[i];

            // Process the item (may decrypt if needed)
            item = _self.verifyAndDecryptMessage(item);

            // Auto-handle WebRTC signaling
            if (item.type === 'webrtc-signaling' && typeof _self.onWebRtcSignaling === 'function') {
                _self.onWebRtcSignaling(item);
            }

            // Auto-handle agent-connect/disconnect
            if (item.type === 'agent-connect') {
                _self._onAgentConnectInternal(item.from, item);
            } else if (item.type === 'agent-disconnect') {
                _self._onAgentDisconnectInternal(item.from);
            }

            dataArray.push(item);
        }

        // Update last receive range
        if (itemsArray.length > 0) {
            const maxOffset = itemsArray.reduce((max, item) => Math.max(max, item.offset || 0), 0);
            if (_self._last_receive_range) {
                _self._last_receive_range.globalOffset = maxOffset;
            }
        }

        // Dispatch message event
        if (dataArray.length > 0) {
            _self.dispatchEvent('message', {
                response: {
                    status: 'success',
                    data: dataArray
                }
            });
        }
    };

    /**
     * Send message via WebSocket
     * @private
     */
    AgentConnection.prototype._websocketSend = function(action, payload, callback) {
        const _self = this;

        if (!_self._websocket || _self._websocket.readyState !== WebSocket.OPEN) {
            console.warn('[WebSocket] Not connected');
            if (callback) callback({ status: 'error', statusMessage: 'WebSocket not connected' });
            return false;
        }

        const messageId = ++_self._websocketMessageId;
        // Note: No API key needed - sessionId provides authenticated context
        const message = {
            ...payload,
            action: action,
            sessionId: _self.sessionId,
            messageId: messageId
        };

        if (callback) {
            _self._websocketMessageCallbacks.set(messageId, callback);
            // Timeout for callback
            setTimeout(() => {
                if (_self._websocketMessageCallbacks.has(messageId)) {
                    _self._websocketMessageCallbacks.delete(messageId);
                    callback({ status: 'error', statusMessage: 'WebSocket request timeout' });
                }
            }, 30000);
        }

        _self._websocket.send(JSON.stringify(message));
        return true;
    };

    /**
     * Disconnect WebSocket
     * @private
     */
    AgentConnection.prototype._disconnectWebSocket = function() {
        const _self = this;

        if (_self._websocket) {
            _self._websocketReconnectAttempts = 5; // Prevent reconnect
            _self._websocket.close();
            _self._websocket = null;
            _self._websocketConnected = false;
        }
    };

    AgentConnection.prototype.connect = function({
             api = '../',
             apiKey = null,
             apiKeyScope = 'private',

             channelName = null,
             channelPassword = null,
             agentName = null,

             sessionId = null,
             channelId = null,

             enableWebrtcRelay = null,
             useWebsocket = null,

             customEventType = null,
             autoReceive = false,
             useInitialReceiveConfig = false,

             defaultLimit = null,
             pollSource = 'AUTO',
         } = {}){

        const _self = this;
        console.log('_self.readyState = ', _self.readyState)
        if(_self.readyState){
            return _self.dispatchEvent('connect',{response : {status : 'error',data : 'Channel is in ready/connecting state.'}});
        }

        // Record agent connection start time
        _self._agentCreationTime = Date.now();

        _self.readyState = 'connecting';

        _self._api = api;
        _self.defaultLimit = defaultLimit || DEFAULT_RECEIVE_LIMIT;

        // store API key and header name for subsequent requests
        if(apiKey !== null){
            _self._apiKey = apiKey;
        }

        // Override useWebsocket if provided in config
        if(useWebsocket !== null){
            _self.useWebsocket = useWebsocket;
        }

        // Accept either channelName or channelId
        _self._channelName = channelName;
        _self.channelId = channelId || _self.channelId;

        // validate password only if provided
        if(typeof channelPassword === 'string' && channelPassword.search(channelPasswordRegex) !== -1){
            _self.readyState = false;
            return _self.dispatchEvent('connect',{response : {status : 'error',data : "Channel key shouldn't have any character in (*\\/,) and no space"}});
        }

        _self._channelPassword = channelPassword;

        _self.agentName = agentName || _self.agentName;

        // Override enableWebrtcRelay if provided in config
        if(enableWebrtcRelay !== null){
            _self.enableWebrtcRelay = enableWebrtcRelay;
        }

        _self.apiKeyScope = apiKeyScope;

        // Store default poll source
        _self.defaultPollSource = pollSource || 'AUTO';

        // Rebuild config object for internal use (recursive calls, events, etc.)
        const config = {
            api,
            apiKey,
            channelName,
            channelPassword,
            sessionId,
            channelId,
            agentName: _self.agentName,
            customEventType,
            autoReceive,
            useInitialReceiveConfig,
            enableWebrtcRelay: _self.enableWebrtcRelay,
            apiKeyScope : _self.apiKeyScope,
            defaultLimit
        };

        // If we're connecting using channelId or using apiKey without password, skip deriving channel secret
        const connectingByChannelId = !!channelId;
        const connectingByApiKeyOnly = !!(_self._apiKey && _self._channelName && !_self._channelPassword);

        // Gets agent key only when channelName AND channelPassword are provided and no secret yet
        if (!_self._channelSecret && !connectingByChannelId && !connectingByApiKeyOnly)
        {
            if(_self._channelName && _self._channelPassword){
                MySecurity.deriveChannelSecret(_self._channelName, _self._channelPassword).then(channelSecret => {
                    _self.readyState = false;
                    _self._channelSecret = channelSecret;
                    _self.connect(config);
                });
                return;
            }
        }

        // Gets server's public key if needed
        if(!_self._pubKeyEncryptor && this.usePubKey){
            // public key mode is on
            getPublicKey({
                base : _self._api,
                apiKey: _self._apiKey,
                callback : function(response){
                    _self.readyState = false;
                    if(response.status === 'error'){
                        _self.dispatchEvent('connect',{response : {status : 'error',data : 'Unable to get the public key'}});
                    }else{
                        _self._pubKeyEncryptor = new JSEncrypt();
                        _self._pubKeyEncryptor.setPublicKey(response.data);
                        _self.connect(config);
                    }
                }

            });

            return;
        }

        // prepare payload: either channelId-based or channelName-based
        let payload;
        let agentContext = {
            agentType: 'WEB-AGENT',
            descriptor: navigator.userAgent,
            customEventType: customEventType || ''
        };
        if(connectingByChannelId){
            payload = {
                sessionId: sessionId || '',
                channelId: channelId,
                agentName: _self.agentName,
                agentContext,
                enableWebrtcRelay: _self.enableWebrtcRelay || false,
                apiKeyScope
            };
        } else {
            let channelPasswordHash = '';
            if(_self._channelPassword && _self._channelSecret){
                channelPasswordHash = MySecurity.hash(_self._channelPassword, _self._channelSecret);
            }

            payload = {
                sessionId: sessionId || '',
                channelName: _self._channelName,
                channelPassword: channelPasswordHash,
                agentName: _self.agentName,
                agentContext,
                enableWebrtcRelay: _self.enableWebrtcRelay || false,
                apiKeyScope
            };
        }

        console.log('payload', payload)

        request({
            useSyncMode : _self.useSyncMode,
            onreset : _self.onreset,
            pubKeyEncryptor:_self._pubKeyEncryptor,
            base : _self._api,
            apiKey: _self._apiKey,
            method : 'post',
            action : 'connect',
            payload : payload,

            callback : function(response){

                const event = {config}

                if(response.status === 'success') {

                    let apiResponse = extractApiResponse(response);
                    if(apiResponse.status === 'error'){
                        event.response = apiResponse;
                        _self.dispatchEvent('connect', event);
                        _self.readyState = false;
                        return;
                    }

                    _self.initSession(apiResponse.data, {
                        connectingByChannelId,
                        checkPasswordRequest: true,
                        autoReceive,
                        event,
                        useInitialReceiveConfig
                    });

                } else
                {
                    _self.readyState = false;
                    event.response = response;
                    _self.dispatchEvent('connect', event);
                }
            }
        });
    }

    /**
     * Initialize session from connect response data
     * Handles setting session fields, role, receive config, and triggering subsequent actions
     *
     * @param {Object} apiResponseData - Response data from connect API call
     * @param {Object} options - Options object with named parameters
     * @param {boolean} options.connectingByChannelId - If connecting via channelId
     * @param {boolean} options.checkPasswordRequest - If should check password request
     * @param {boolean|number} options.autoReceive - Auto-receive flag/interval
     * @param {Object} options.event - Event object to dispatch on completion
     */
    AgentConnection.prototype.initSession = function(apiResponseData,
                                                     {
                                                         connectingByChannelId,
                                                         checkPasswordRequest,
                                                         autoReceive,
                                                         useInitialReceiveConfig = false,
                                                         event} = {}) {
        const _self = this;

        if (!apiResponseData) {
            console.error('initSession: apiResponseData is required');
            return false;
        }

        try {
            // Set connection time
            _self.connectTime = apiResponseData.date;

            // Save initial receive config from state FIRST
            // initialReceiveConfig represents the STARTING point (where to begin reading)
            // - globalOffset = originalGlobalOffset (where this channel instance started)
            // - localOffset = 0 (start from beginning of this instance)
            //
            // currentReceiveConfig represents the CURRENT state at connect time
            // - globalOffset = current globalOffset (where channel is NOW)
            // - localOffset = current localOffset (current position in instance)
            if (apiResponseData.state || apiResponseData.metadata) {
                const stateData = apiResponseData.state || apiResponseData.metadata;
                const startGlobalOffset = stateData.originalGlobalOffset !== undefined
                    ? stateData.originalGlobalOffset
                    : (stateData.globalOffset || 0);

                _self.initialReceiveConfig = {
                    globalOffset: startGlobalOffset,
                    localOffset: 0,
                    limit: _self.defaultLimit || DEFAULT_RECEIVE_LIMIT,
                };

                _self.currentReceiveConfig = {
                    globalOffset: stateData.globalOffset || 0,
                    localOffset: stateData.localOffset || 0,
                    limit: _self.defaultLimit || DEFAULT_RECEIVE_LIMIT,
                };
            }

            // Reset receive range if session changed - use initialReceiveConfig
            if(_self.sessionId !== apiResponseData.sessionId){
                // Create a copy of initialReceiveConfig for _last_receive_range
                _self._last_receive_range = _self.initialReceiveConfig ?
                    { ..._self.initialReceiveConfig } :
                    { globalOffset: 0, localOffset: 0, limit: _self.defaultLimit || DEFAULT_RECEIVE_LIMIT };
            }

            // Set session and channel IDs
            _self.sessionId = apiResponseData.sessionId;
            _self.channelId = apiResponseData.channelId || _self.channelId;

            // Extract ICE servers from connect response if provided
            if (apiResponseData.iceServers && Array.isArray(apiResponseData.iceServers)) {
                _self.iceServers = apiResponseData.iceServers;
                console.log('[AgentConnection] Received ICE servers from connect response:', _self.iceServers.length, 'server(s)');
            }

            // Set session role
            _self._session_role = apiResponseData.role;

            // Calculate connection timing
            let connectionTimeMs = null;
            if (_self._agentCreationTime) {
                connectionTimeMs = Date.now() - _self._agentCreationTime;
                console.log(`[AgentConnection] ⏱️  Agent ready (took ${connectionTimeMs}ms from connect call to ready state)`);
            }

            _self.readyState = true;

            // Register this connection in the active connections registry
            _registerConnection(_self);

            // Clear any pending reconnect timer (successful connection)
            if(_self._reconnectTimer){
                clearTimeout(_self._reconnectTimer);
                delete _self._reconnectTimer;
            }


            console.log('InitSession - initialReceiveConfig:', _self.initialReceiveConfig,
                'useInitialReceiveConfig:', useInitialReceiveConfig);

            if (useInitialReceiveConfig && this.initialReceiveConfig) {
                this._last_receive_range = {
                    globalOffset: this.initialReceiveConfig.globalOffset,
                    localOffset: this.initialReceiveConfig.localOffset,
                    limit: this.initialReceiveConfig.limit
                };
            }

            // Handle password request flow if needed
            if (connectingByChannelId && !_self._channelSecret && checkPasswordRequest) {
                (async function(){
                    try {
                        const { publicKeyPem, privateKey } = await MySecurity.rsaGenerate();
                        _self._pending_password_key = privateKey;

                        const payload = JSON.stringify({ publicKeyPem: publicKeyPem });
                        _self.send({
                            type: 'password-request',
                            to: '*',
                            encrypted: false,
                            content: payload,
                            sessionId: _self.sessionId
                        }, function(resp){
                            // ignore response; we'll wait for PASSWORD_REPLY via receive
                        });
                    } catch (err) {
                        console.error('Failed to initiate REQUEST_PASSWORD flow', err);
                    }
                })();
            }

            // Register active session
            AgentConnection.activeSessions = AgentConnection.activeSessions || {};
            AgentConnection.activeSessions[_self.sessionId] = _self;

            // Get active agents and dispatch connect event
            _self.getActiveAgents(function(agentsRes){
                const agents = agentsRes.status === 'success' ? agentsRes.data : [];

                _self._connectedAgentsMap = {}
                for (let i = 0; i < agents.length; i++) {
                    let agentData = agents[i];
                    let agentName = null;

                    if (typeof agentData === 'object') {
                        agentName = agentData.name || agentData.agentName;
                        // Store full AgentInfo object (includes connectionTime)
                        _self._connectedAgentsMap[agentName] = agentData;
                    } else {
                        agentName = agentData;
                        _self._connectedAgentsMap[agentName] = {};
                    }
                }

                _self._updateAgents();

                // Dispatch connect event with timing information
                if (event) {
                    event.response = { status : 'success', data: apiResponseData, connectionTimeMs: connectionTimeMs };
                    _self.dispatchEvent('connect', event);
                }

                // Connect WebSocket if enabled (after successful HTTP connect)
                if (_self.useWebsocket) {
                    console.log('[WebSocket] Connecting WebSocket for real-time messaging...');
                    _self._connectWebSocket();
                }

                // Start auto-receive if enabled
                if(autoReceive){
                    _self.autoReceive = autoReceive;
                    // If using WebSocket, messages will be pushed automatically
                    // Otherwise, use HTTP polling
                    if (!_self.useWebsocket) {
                        // Use _last_receive_range if set, otherwise use initialReceiveConfig as fallback
                        const fallbackRange = _self._last_receive_range || _self.initialReceiveConfig ||
                            { globalOffset: 0, localOffset: 0, limit: _self.defaultLimit || DEFAULT_RECEIVE_LIMIT };
                        _self.receive(fallbackRange);
                    }
                }
            });

            return true;
        } catch (err) {
            console.error('Error in initSession:', err);
            return false;
        }
    }

    AgentConnection.prototype.disconnect = function(config){

        const _self = this;

        if(!_self.readyState){
            return;
        }

        _self.readyState = false;

        // Disconnect WebSocket if connected
        if (_self.useWebsocket) {
            _self._disconnectWebSocket();
        }

        if(_self._receive_xhr){
            abortRequest(_self._receive_xhr);
            _self._receive_xhr = null;
        }

        // Clear any pending reconnect timer
        if(_self._reconnectTimer){
            clearTimeout(_self._reconnectTimer);
            delete _self._reconnectTimer;
        }

        const session = _self.sessionId;

        // Build base payload; include asyncDisconnect flag if requested via config
        const payloadObj = { sessionId: session };
        if (config && config.useBeacon) {
            payloadObj.asyncDisconnect = true;
        }

        request({
            useSyncMode : _self.useSyncMode,
            base : _self._api,
            pubKeyEncryptor:_self._pubKeyEncryptor,
            apiKey: _self._apiKey,
            method : 'post',
            action : 'disconnect',
            payload : payloadObj,
            callback : function(response){
                AgentConnection.activeSessions = AgentConnection.activeSessions || {};
                delete  AgentConnection.activeSessions[_self.sessionId];

                // Unregister this connection from the active connections registry
                _unregisterConnection(_self);

                _self.dispatchEvent('disconnect',{response : response});
            }

        });

        // If config indicates to use beacon, send via navigator.sendBeacon
        if (config && config.useBeacon) {
            const url = getActionUrl(_self._api, false, 'disconnect');
            const payload = JSON.stringify(payloadObj);

            // Use fetch with keepalive option for older browsers
            if (navigator.sendBeacon) {
                const blob = new Blob([payload], { type: 'application/json' });
                navigator.sendBeacon(url, blob);
            } else {
                // Fallback to regular fetch
                fetch(url, {
                    method: 'POST',
                    body: payload,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    keepalive: true
                }).catch(err => {
                    console.error('Failed to send disconnect beacon:', err);
                });
            }
        }
    }

    AgentConnection.prototype.getSessionInfo = function(){
        return {
            name: this._channelName,
            password: this._channelPassword,
            channelId: this.channelId,
            sessionId: this.sessionId
        };
    }

    // New helper: process a single received item (decrypt & verify if needed) and return the item
    AgentConnection.prototype.verifyAndDecryptMessage = function(item){

        // Handle agent-to-agent encrypted messages
        if(item && item.encrypted && this._channelSecret) {
            const plain = MySecurity.decryptAndVerify(item.content, this._channelSecret);

            if(!plain){
                console.log('Some corrupted data item and will be ignored');
                return {};
            } else {
                item.content = plain;
                item.encrypted = false;
            }
        }

        return item;
    }

    AgentConnection.prototype.receive = function (range, autoReceive, options = {}){

        const _self = this;
        // Allow override of useWebsocket per call
        const useWebsocket = options.useWebsocket !== undefined ? options.useWebsocket : _self.useWebsocket;

        _self._rcv_failed_count = _self._rcv_failed_count || 0;
        _self._rcv_empty_count = _self._rcv_empty_count || 0;

        _self.autoReceive = autoReceive || _self.autoReceive;

        if(!_self.readyState){
            return;
        }

        // If using WebSocket and connected, messages are pushed automatically
        // No need for HTTP polling
        if (useWebsocket && _self._websocketConnected) {
            console.log('[WebSocket] Using WebSocket for receiving - messages will be pushed automatically');
            return;
        }

        if(_self._receive_xhr){
            abortRequest(_self._receive_xhr);
            _self._receive_xhr = null;
        }

        const session = _self.sessionId;

        // Add pollSource to receiveConfig if not already present
        const receiveConfig = {
            ...range,
            pollSource: range.pollSource || _self.defaultPollSource
        };

        _self._receive_xhr = request({
            useSyncMode : _self.useSyncMode,
            onreset : _self.onreset,
            pubKeyEncryptor:_self._pubKeyEncryptor,
            base : _self._api,
            apiKey: _self._apiKey,
            method : 'post',
            action : 'pull',
            payload: {sessionId: session, receiveConfig: receiveConfig},
            //timeout : 5 * 60 * 1000,
            callback : function(response){

                delete _self._receive_xhr;

                if(response.status === 'error'){
                    // Use common handler for "Agent session not found" errors
                    if(_self._handleAgentSessionNotFound(response)){
                        // Error was handled (session not found + reconnect scheduled)
                        // Dispatch message event and don't continue with autoReceive loop
                        _self.dispatchEvent('message', {response : response});
                        return;
                    }

                    // Other errors - just dispatch event
                    _self.dispatchEvent('message', {response : response});
                } else {
                    let data = extractApiResponse(response).data || {};

                    const itemsArray = data.events || [];
                    const ephemeralArray = data.ephemeralEvents || [];

                    const dataArray = [];

                    // Process both normal events and ephemeral events
                    const allItems = [...itemsArray, ...ephemeralArray];

                    for (let i = 0; i < allItems.length; i++) {

                        let item = allItems[i];
                        console.debug('item=', item)

                        // Process the item (may decrypt if needed)
                        item = _self.verifyAndDecryptMessage(item);

                        // Auto-handle PASSWORD_REPLY encrypted to this agent using the pending private key
                        // Only handle events that are newer than the connect time
                        try{
                            // for webrtc-signaling, we may need to handle even if date is older than connectTime
                            if (item.date > _self.connectTime || item.type === 'webrtc-signaling') {
                                // Auto-handle PASSWORD_REPLY encrypted to this agent using the pending private key
                                if (item.type === 'password-reply' && item.to === _self.agentName
                                    && !_self._channelSecret) {
                                    (async function() {
                                        const dec = await MySecurity.rsaDecrypt(_self._pending_password_key, item.content);
                                        // payload may be JSON with { channelName, channelPassword } or a plain password string
                                        let channelNameFromReply = null;
                                        let channelPasswordFromReply = dec;
                                        const parsed = JSON.parse(dec);
                                        if(parsed.channelPassword) channelPasswordFromReply = parsed.channelPassword;
                                        if(parsed.channelName) channelNameFromReply = parsed.channelName;

                                        // If server provided channelName in the reply, and we don't have one yet, use it
                                        if(channelNameFromReply && !_self._channelName){
                                            _self._channelName = channelNameFromReply;
                                        }

                                        // Set channel password from reply
                                        _self._channelPassword = channelPasswordFromReply;

                                        // Derive and set channel secret using known channel name and password
                                        if(_self._channelName && _self._channelPassword){
                                            MySecurity.deriveChannelSecret(_self._channelName, _self._channelPassword).then(secret => {
                                                _self._channelSecret = secret;
                                            }).catch(err => {
                                                console.error('Failed to derive channel secret from PASSWORD_REPLY', err);
                                            });
                                        }
                                    })();
                                }

                                    // Auto-handle PASSWORD_REQUEST: when another agent requests the channel password they
                                    // include their public key (PEM) in the event content. If we know the channel name/password
                                // respond by encrypting them with the provided public key and send a 'password-reply' to the requester.
                                else if (item.type === 'password-request' && item.content) {
                                    // don't reply to our own requests
                                    if (item.from === _self.agentName) {
                                        // ignore
                                    } else if (_self._channelName && _self._channelPassword) {
                                        const requesterPubKeyPem = JSON.parse(item.content).publicKeyPem;
                                        // Use WebCrypto RSA-OAEP so the recipient (which uses WebCrypto to decrypt) can decrypt
                                        (async function(){
                                            let allowed = true;
                                            if (typeof _self.onPasswordRequest === 'function') {
                                                // support sync or Promise-returning handlers
                                                const res = _self.onPasswordRequest(_self.channelId, item.from, requesterPubKeyPem);
                                                if (res && typeof res.then === 'function') {
                                                    allowed = await res;
                                                } else {
                                                    allowed = !!res;
                                                }
                                            }

                                            if (!allowed) {
                                                console.info('Password request from', item.from, 'was declined by onPasswordRequest handler');
                                                return;
                                            }

                                            const payloadObj = {
                                                channelName: _self._channelName,
                                                channelPassword: _self._channelPassword
                                            };
                                            const cipherB64 = await MySecurity.rsaEncrypt(requesterPubKeyPem,
                                                JSON.stringify(payloadObj));

                                            if (cipherB64) {
                                                _self.send({
                                                    type: 'password-reply',
                                                    to: item.from || '*',
                                                    encrypted: false,
                                                    content: cipherB64,
                                                    sessionId: _self.sessionId
                                                }, function(resp) {
                                                    // no-op callback
                                                });
                                            }

                                        })();
                                    }
                                }

                                // connect/disconnect notifications
                                else if (item.type === 'connect'){
                                    // Parse AgentInfo from content (includes connectionTime and metadata)
                                    let agentInfo = null;
                                    try {
                                        if (item.content) {
                                            agentInfo = JSON.parse(item.content);
                                        }
                                    } catch (e) {
                                        console.warn('Failed to parse AgentInfo from CONNECT event:', e);
                                    }

                                    // Store AgentInfo in _connectedAgentsMap
                                    if (agentInfo && typeof agentInfo === 'object') {
                                        _self._connectedAgentsMap[item.from] = agentInfo;
                                    } else {
                                        // Fallback: fetch from getActiveAgents if parsing failed
                                        _self.getActiveAgents(function(agentsRes){
                                            if (agentsRes.status === 'success') {
                                                const agents = agentsRes.data || [];
                                                const newAgentInfo = agents.find(a => {
                                                    const name = typeof a === 'object' ? (a.name || a.agentName) : a;
                                                    return name === item.from;
                                                });
                                                if (newAgentInfo && typeof newAgentInfo === 'object') {
                                                    _self._connectedAgentsMap[item.from] = newAgentInfo;
                                                } else {
                                                    _self._connectedAgentsMap[item.from] = {};
                                                }
                                            }
                                        });
                                    }

                                    _self._updateAgents();

                                    // Dispatch agent-connect event
                                    _self.dispatchEvent('agent-connect', {
                                        agentName: item.from,
                                        timestamp: item.date,
                                        systemEvent: item.systemEvent
                                    });
                                }
                                else if (item.type === 'disconnect'){
                                    delete _self._connectedAgentsMap[item.from];
                                    _self._updateAgents();
                                    // Dispatch agent-disconnect event (systemEvent false for normal agent disconnects)
                                    const parsedContent = JSON.parse(item.content);
                                    _self.dispatchEvent('agent-disconnect', {
                                        agentName: item.from,
                                        timestamp: item.date,
                                        systemEvent: item.systemEvent,
                                        agentContext: parsedContent?.agentContext || parsedContent?.metadata, // Support legacy metadata field
                                    });
                                }

                                // WebRTC video stream signaling
                                else if (item.type === 'webrtc-signaling') {
                                    const signalingMsg = JSON.parse(item.content);
                                    const streamId = signalingMsg.streamSessionId;
                                    const sourceAgent = item.from;
                                    _self._handleWebRtcSignaling(streamId, sourceAgent, signalingMsg);
                                }
                            }
                        } catch (err) {
                            console.error('Error auto processing event item', item, ', error: ', err);
                        }

                        dataArray.push(item);
                    }

                    // Updates offsets for next receive
                    range.globalOffset = data.nextGlobalOffset || range.globalOffset;
                    range.localOffset = data.nextLocalOffset || range.localOffset;
                    response.data = dataArray;

                    _self.dispatchEvent('message', {response: response});

                    _self._last_receive_range = range;
                }

                if(_self.autoReceive){

                    // max fail count limit and cost per fail
                    const fail_count_limit = 10;

                    // cost increase per fail in ms
                    const fail_cost_change = 1000;

                    let empty_data_count_limit = 30;
                    let emptyDataTimeoutChange = 500;

                    let additionalTimeout = 0;
                    let emptyCheckFactor = 0;

                    if(_self.autoReceive === true || typeof _self.autoReceive === 'number'){
                        additionalTimeout = _self.autoReceive === 'number'?_self.autoReceive:1000;
                    }

                    if(response.status === 'success'/* && extractApiResponse(response)*/){
                        _self._rcv_failed_count = 0;
                        if(!response.data || response.data.length === 0){
                            if(_self._rcv_empty_count < empty_data_count_limit){
                                _self._rcv_empty_count++
                            }
                        }else{
                            _self._rcv_empty_count = 0;
                        }
                    }else{
                        if(_self._rcv_failed_count < fail_count_limit){
                            _self._rcv_failed_count ++;
                        }
                    }

                    let timeout = _self._rcv_failed_count * fail_cost_change
                        + (_self._rcv_empty_count - 1) * emptyCheckFactor * emptyDataTimeoutChange
                        + additionalTimeout;

                    console.log('Next receive timeout : '+timeout);
                    setTimeout(function(){
                        _self.receive(_self._last_receive_range);
                    }, timeout);
                }
            }

        });

    }

    AgentConnection.prototype.sendMessage = function(eventMessage, callback, options = {}){

        let content,to,filter,type, customType, ephemeral;
        // Allow override of useWebsocket per call
        const useWebsocket = options.useWebsocket !== undefined ? options.useWebsocket : this.useWebsocket;

        if(typeof eventMessage === 'object'){
            content = eventMessage.content;
            to = eventMessage.to;
            filter = eventMessage.filter;
            type = eventMessage.type;
            customType = eventMessage.customType;
            ephemeral = eventMessage.ephemeral;
        } else {
            content = eventMessage;
        }

        if(to && filter){
            throw new Error('Config should have either "to" or "filter" fields');
        }
        if(!content){
            throw new Error("Invalid arguments format : first argument should be as an object or string and second one should be as callback function."
                +"The content should be defined either in the obj or as string parameter in the first argument");
        }

        const _self = this;

        if(!_self.readyState || !_self.sessionId){
            typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
            return;
        }

        const session = _self.sessionId;

        if(DISABLE_ENCRYPTION)
        {
            delete _self._channelSecret;
        }

        const payload = {
            type: type || 'chat-text',
            to : (to && RegExp.quote(to)) || filter || '*',
            encrypted : !!_self._channelSecret,
            content : _self._channelSecret ? MySecurity.encryptAndSign(content, _self._channelSecret) : content,
            sessionId : session
        };

        // Add ephemeral flag for short-term messages (WebRTC signaling, etc.)
        if (ephemeral) {
            payload.ephemeral = true;
        }

        if (customType)
        {
            if (payload.type !== 'CUSTOM')
            {
                console.warn('MessageEvent config has customType and type is not CUSTOM - overriding type to CUSTOM');
                payload.type = 'CUSTOM';
            }

            payload.customType = customType;
        }

        console.log('Sending payload : ');
        console.log(payload);

        // Use WebSocket if enabled and connected
        if (useWebsocket && _self._websocketConnected) {
            _self._websocketSend('push', payload, function(response) {
                if (callback) {
                    callback(response);
                }
            });
        } else {
            // Fallback to HTTP
            request({
                useSyncMode : _self.useSyncMode,
                base : _self._api,
                pubKeyEncryptor:_self._pubKeyEncryptor,
                apiKey: _self._apiKey,
                method : 'post',
                action : 'push',
                payload : payload,
                //timeout : 10 * 60 * 1000,
                id : _self.channelId,
                callback : callback,
                retryChances : 3
            });
        }

    }

    /**
     * Common handler for "Agent session not found" errors
     * This centralizes the logic for handling session not found across all XHR callbacks
     * @param {object} response - The error response from server
     * @returns {boolean} - True if error was handled (session not found), false otherwise
     */
    AgentConnection.prototype._handleAgentSessionNotFound = function(response){
        const _self = this;

        // Check if the error is "Agent session not found"
        const errorMessage = response.statusMessage || response.data || response.error || '';

        if(!errorMessage || typeof errorMessage !== 'string' || !errorMessage.includes('Agent session not found')){
            return false; // Not a session not found error
        }

        console.warn('[web-agent] Agent session not found - will attempt to reconnect in 20 seconds');

        // Clear ready state to prevent other operations
        _self.readyState = false;

        // Store connection parameters for reconnection
        const reconnectParams = {
            api: _self._api,
            apiKey: _self._apiKey,
            channelId: _self.channelId,
            channelName: _self._channelName,
            channelPassword: _self._channelPassword,
            agentName: _self.agentName,
            devApiKey: _self._devApiKey,
            autoReceive: _self.autoReceive,
            enableWebrtcRelay: _self._enableWebrtcRelay,
            defaultLimit: _self.defaultLimit
        };

        // Schedule reconnection after 20 seconds (only if not already scheduled)
        if(!_self._reconnectTimer){
            _self._reconnectTimer = setTimeout(function(){
                delete _self._reconnectTimer;
                console.log('[web-agent] Attempting to reconnect after session not found...');

                // Dispatch reconnecting event
                _self.dispatchEvent('reconnecting', {
                    reason: 'Agent session not found',
                    timestamp: Date.now()
                });

                // Attempt reconnection
                _self.connect(reconnectParams);
            }, 20000); // 20 seconds
        }

        // Dispatch event to notify application
        _self.dispatchEvent('session-not-found', {
            reason: 'Agent session not found',
            timestamp: Date.now(),
            willReconnect: true
        });

        return true; // Error was handled
    };

    // Lightweight helper to send an event payload via the channel (uses existing request wrapper)
    AgentConnection.prototype.send = function(payload, callback){
        const _self = this;
        if(!_self.readyState || !_self.sessionId){
            typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
            return;
        }
        request({
            useSyncMode : _self.useSyncMode,
            base : _self._api,
            pubKeyEncryptor:_self._pubKeyEncryptor,
            apiKey: _self._apiKey,
            method : 'post',
            action : 'push',
            payload : payload,
            id : _self.channelId,
            callback : callback,
            retryChances : 1
        });
    }

    // ============================================
    // Channel Storage API Methods
    // ============================================

    /**
     * Internal helper for storage PUT/ADD operations (eliminates code duplication)
     * @private
     */
    AgentConnection.prototype._storageWrite = function(endpoint, storageKey, content, encrypted, metadata, callback){
        const _self = this;

        if(!_self.readyState || !_self.sessionId){
            typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
            return;
        }

        // Convert content to JSON if it's an object
        let contentStr;
        if (typeof content === 'object') {
            contentStr = JSON.stringify(content);
        } else {
            contentStr = content;
        }

        // Encrypt content if encrypted flag is true and channel secret exists
        if (encrypted && _self._channelSecret) {
            console.log('[Storage] Encrypting content with channel secret');
            contentStr = MySecurity.encryptAndSign(contentStr, _self._channelSecret);
        } else if (encrypted && !_self._channelSecret) {
            console.warn('[Storage] Encryption requested but no channel secret available - storing unencrypted');
            encrypted = false;
        }

        // Convert to bytes
        const contentBytes = new TextEncoder().encode(contentStr);

        // Convert bytes to base64 in chunks to avoid "Maximum call stack size exceeded"
        let binary = '';
        const chunkSize = 8192; // Process 8KB at a time
        for (let i = 0; i < contentBytes.length; i += chunkSize) {
            const chunk = contentBytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        const contentBase64 = btoa(binary);

        // Default metadata if not provided
        const metadataObj = metadata || {
            contentType: 'application/json',
            description: null,
            version: null,
            properties: null
        };

        const payload = {
            sessionId: _self.sessionId,
            storageKey: storageKey,
            content: contentBase64,
            encrypted: !!encrypted,
            metadata: metadataObj
        };

        // Use direct XHR for storage endpoints (not WebSocket actions)
        const xhr = new XMLHttpRequest();
        xhr.open('POST', getStorageUrl(_self._api, endpoint));
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    typeof callback === 'function' && callback({status: 'success', data: response});
                } catch(e) {
                    typeof callback === 'function' && callback({status: 'error', data: 'Invalid response'});
                }
            } else {
                typeof callback === 'function' && callback({status: 'error', data: xhr.responseText || xhr.statusText});
            }
        };

        xhr.onerror = function() {
            typeof callback === 'function' && callback({status: 'error', data: 'Network error'});
        };

        xhr.send(JSON.stringify(payload));
    }

    /**
     * PUT: Replace all versions of a storage key with new content
     * @param {object} options - Storage options {storageKey, content, encrypted, metadata}
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.storagePut = function(options, callback){
        const {storageKey, content, encrypted = false, metadata = null} = options;
        this._storageWrite('put', storageKey, content, encrypted, metadata, callback);
    }

    /**
     * ADD: Append new version (keeps existing versions)
     * @param {object} options - Storage options {storageKey, content, encrypted, metadata}
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.storageAdd = function(options, callback){
        const {storageKey, content, encrypted = false, metadata = null} = options;
        this._storageWrite('add', storageKey, content, encrypted, metadata, callback);
    }

    /**
     * GET: Retrieve latest version by key
     * @param {object} options - Storage options {storageKey}
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.storageGet = function(options, callback){
        const {storageKey} = options;
        const _self = this;

        if(!_self.readyState || !_self.sessionId){
            typeof callback === 'function' && callback({status: 'error', data : 'The channel is not ready.'});
            return;
        }

        const xhr = new XMLHttpRequest();
        xhr.open('POST', getStorageUrl(_self._api, 'get'));
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.responseType = 'arraybuffer';

        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    // Decode response
                    const text = new TextDecoder('utf-8').decode(xhr.response);
                    let data = JSON.parse(text);

                    // Check if encrypted
                    const isEncrypted = xhr.getResponseHeader('X-Storage-Encrypted') === 'true';

                    // Auto-decrypt if needed
                    if (isEncrypted && _self._channelSecret) {
                        console.log('[Storage] Auto-decrypting content');
                        const decrypted = MySecurity.decryptAndVerify(
                            typeof data === 'string' ? data : JSON.stringify(data),
                            _self._channelSecret
                        );
                        // Try to parse as JSON, fallback to string
                        try {
                            data = JSON.parse(decrypted);
                        } catch(e) {
                            data = decrypted;
                        }
                    } else if (isEncrypted && !_self._channelSecret) {
                        console.warn('[Storage] Content encrypted but no channel secret available');
                    }

                    typeof callback === 'function' && callback({
                        status: 'success',
                        data: data,
                        encrypted: isEncrypted
                    });
                } catch(e) {
                    console.error('[Storage] Failed to parse/decrypt:', e);
                    typeof callback === 'function' && callback({
                        status: 'error',
                        data: 'Failed to load storage: ' + e.message
                    });
                }
            } else if (xhr.status === 404) {
                typeof callback === 'function' && callback({
                    status: 'error',
                    data: 'Storage key not found'
                });
            } else {
                typeof callback === 'function' && callback({
                    status: 'error',
                    data: 'Failed to retrieve storage: ' + xhr.statusText
                });
            }
        };

        xhr.onerror = function() {
            typeof callback === 'function' && callback({
                status: 'error',
                data: 'Network error'
            });
        };

        xhr.send(JSON.stringify({
            sessionId: _self.sessionId,
            storageKey: storageKey
        }));
    }

    /**
     * GET LIST: Retrieve all versions by key
     * @param {string} storageKey - Storage key
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.storageGetList = function(storageKey, callback){
        this._storageRequest('getList', storageKey, callback);
    }

    /**
     * GET KEYS: Get all storage keys for the channel
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.storageKeys = function(callback){
        this._storageRequest('keys', null, callback);
    }

    /**
     * GET VALUES: Get all storage metadata for the channel
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.storageValues = function(callback){
        this._storageRequest('values', null, callback);
    }

    /**
     * DELETE BY KEY: Delete all versions for a storage key
     * @param {string} storageKey - Storage key to delete
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.storageDeleteByKey = function(storageKey, callback){
        this._storageRequest('deleteByKey', storageKey, callback);
    }

    /**
     * Internal helper for storage requests with optional storageKey parameter
     * @private
     */
    AgentConnection.prototype._storageRequest = function(endpoint, storageKey, callback){
        const _self = this;

        if(!_self.readyState || !_self.sessionId){
            typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
            return;
        }

        const payload = {
            sessionId: _self.sessionId
        };

        // Add storageKey if provided
        if(storageKey){
            payload.storageKey = storageKey;
        }

        // Use direct XHR for storage endpoints (not WebSocket actions)
        const xhr = new XMLHttpRequest();
        xhr.open('POST', getStorageUrl(_self._api, endpoint));
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    typeof callback === 'function' && callback({status: 'success', data: response});
                } catch(e) {
                    typeof callback === 'function' && callback({status: 'error', data: 'Invalid response'});
                }
            } else {
                typeof callback === 'function' && callback({status: 'error', data: xhr.responseText || xhr.statusText});
            }
        };

        xhr.onerror = function() {
            typeof callback === 'function' && callback({status: 'error', data: 'Network error'});
        };

        xhr.send(JSON.stringify(payload));
    }

    AgentConnection.prototype.status = function(callback){
        const _self = this;

        if(!_self.readyState || !_self.sessionId){
            typeof callback === 'function' && callback({status : 'error',data : 'The channel is not ready.'});
            return
        }

        //var session = _self._session_id.endsWith("-0")?(_self._session_id.split('-')[0]+"-1"):(_self._session_id.split('-')[0]+"-0");
        const session = _self.sessionId;

        request({
            useSyncMode : _self.useSyncMode,
            pubKeyEncryptor:_self._pubKeyEncryptor,
            base : _self._api,
            apiKey: _self._apiKey,
            method : 'post',
            action : 'status',
            payload : {sessionId : session},
            //timeout : 10 * 60 * 1000,
            id : _self.channelId,
            callback : callback
        });

    }

    AgentConnection.prototype.encodeKeyLength = 8;
    AgentConnection.prototype.encodeAuth = function(){
        if(!this.readyState || !this.sessionId){
            throw new Error('The channel is not ready.');
        }

        const key = guid32().substring(0,this.encodeKeyLength || 10);
        const auth = [this._channelName,this._channelPassword];

        const cipher1 = MySecurity.encrypt(auth,md5(key).substring(0,this.encodeKeyLength || 10));
        const cipher2 = MySecurity.encrypt(cipher1,key);

        let str = /*btoa*/(key + cipher2);

        //eliminating unfriendly character '='
        let c = 0;
        while(str.charAt(str.length-1) === '='){
            c++;
            str = str.substring(0,str.length-1);
        }

        return str+c;

    }

    AgentConnection.prototype.decodeAuth = function(encodedAuth){

        let c = parseInt(encodedAuth.charAt(encodedAuth.length-1));
        let str = encodedAuth.substring(0,encodedAuth.length-1);
        while(c > 0){
            str += '=';
            c--;
        }

        const authInfo = /*atob*/(str);
        const key = authInfo.substring(0,this.encodeKeyLength || 10);
        const cipher2 = authInfo.substring(this.encodeKeyLength || 10);
        const cipher1 = MySecurity.decrypt(cipher2,key);

        const auth = MySecurity.decrypt(cipher1,md5(key).substring(0,this.encodeKeyLength || 10));

        const tokens = JSON.parse(auth);

        return {channelName : tokens[0],channelPassword : tokens[1]};

    }
    AgentConnection.prototype._updateAgents = function(){
        this.connectedAgents = Object.keys(this._connectedAgentsMap);
    }

    /**
     * Determine if this agent is the "host" relative to another agent.
     * Host is responsible for sending board state to new joiners and creating DataChannels.
     *
     * If peerAgentName is provided: Returns true if current agent has earlier connectionTime than peer.
     * If peerAgentName is not provided: Returns true if current agent is the overall host (earliest of all).
     *
     * @param {string} [peerAgentName] - Optional peer agent name to compare against
     * @returns {boolean} true if this agent should be the host/initiator, false otherwise
     */
    AgentConnection.prototype.isHostAgent = function(peerAgentName) {
        const agentsInfo = this._connectedAgentsMap || {};
        const myConnectionTime = agentsInfo[this.agentName]?.connectionTime || Date.now();

        // If peer agent specified, compare connection times directly (peer-to-peer host check)
        if (peerAgentName) {
            const peerInfo = agentsInfo[peerAgentName];

            if (!peerInfo || !peerInfo.connectionTime) {
                // Peer not found or no connection time - use alphabetical comparison as fallback
                const isHost = this.agentName < peerAgentName;
                console.log(`[Host Check] Peer ${peerAgentName} not found, using alphabetical: ${this.agentName} < ${peerAgentName} = ${isHost}`);
                return isHost;
            }

            const peerConnectionTime = peerInfo.connectionTime;

            // Current agent is host if it has earlier connection time
            if (myConnectionTime !== peerConnectionTime) {
                const isHost = myConnectionTime < peerConnectionTime;
                console.log(`[Host Check] ${this.agentName} (${myConnectionTime}) vs ${peerAgentName} (${peerConnectionTime}) = ${isHost}`);
                return isHost;
            }

            // If connection times are exactly equal (unlikely), use alphabetical order as tiebreaker
            const isHost = this.agentName < peerAgentName;
            console.log(`[Host Check] Equal times, tiebreaker: ${this.agentName} < ${peerAgentName} = ${isHost}`);
            return isHost;
        }

        // No peer specified - find overall host (earliest connectionTime across all agents)
        const agentNames = Object.keys(agentsInfo);

        if (agentNames.length === 0) {
            return true;  // Only agent, so is host
        }

        // Find agent with earliest connectionTime
        let earliestAgent = this.agentName;
        let earliestTime = myConnectionTime;

        agentNames.forEach(agentName => {
            const agentInfo = agentsInfo[agentName];
            if (agentInfo && agentInfo.connectionTime) {
                if (agentInfo.connectionTime < earliestTime) {
                    earliestTime = agentInfo.connectionTime;
                    earliestAgent = agentName;
                }
            }
        });

        return earliestAgent === this.agentName;
    }


    /**
     * Get the initial receive config saved from connect response
     * @returns {Object|null} {globalOffset, localOffset, limit} or null if not available
     */
    AgentConnection.prototype.getInitialReceiveConfig = function() {
        return this.initialReceiveConfig;
    }

    /**
     * Send WebRTC signaling message (offer, answer, ICE candidate)
     * @param {object} signalingMsg - The signaling data
     * @param {string} remoteAgent - Target agent name, or null to use filter
     * @param {string} filter - Optional filter query for targeted delivery
     */
    AgentConnection.prototype.sendWebRtcSignaling = function(signalingMsg, remoteAgent, filter) {
        const _self = this;
        if (!_self.readyState || !_self.sessionId) {
            console.error('[Channel] Cannot send WebRTC signaling: channel not ready');
            return;
        }

        const payload = {
            type: 'webrtc-signaling',
            ephemeral: true,  // Mark as ephemeral to avoid storage
            to: remoteAgent,
            filter: filter,  // Add filter support
            encrypted: false,
            content: JSON.stringify(signalingMsg),
            sessionId: _self.sessionId,
        };

        request({
            useSyncMode: _self.useSyncMode,
            base: _self._api,
            pubKeyEncryptor: _self._pubKeyEncryptor,
            apiKey: _self._apiKey,
            method: 'post',
            action: 'push',
            payload: payload,
            id: _self.channelId,
            callback: function(response) {
                if (response.status !== 'success') {
                    console.error('[Channel] Failed to send WebRTC signaling:', response);
                }
            },
            retryChances: 1
        });
    }

    /**
     * Process incoming WebRTC signaling message
     * @param {string} streamId - Stream session ID
     * @param {string} sourceAgent - Source agent
     * @param {Object} signalingMsg - Signaling message
     * @private
     */
    AgentConnection.prototype._handleWebRtcSignaling = function(streamId, sourceAgent, signalingMsg) {
        // Ignore signaling messages that originated from this same agent instance
        try {
            if (sourceAgent === this.agentName) {
                // skip self-sent signaling
                return;
            }

            if (this.onWebRtcSignaling) {
                this.onWebRtcSignaling({
                    streamId: streamId,
                    sourceAgent: sourceAgent,
                    signalingMsg: signalingMsg
                });
            }
        } catch (err) {
            console.error('[Channel] Error in WebRTC signaling handler:', err);
        }
    }

    window.AgentConnection = AgentConnection;
    window.MySecurity = MySecurity;
    // Backwards-compatible lowercase alias (user referenced `mysecuruty`):
    window.mysecuruty = MySecurity;

    // Backward compatibility aliases for legacy code
    window.HTTPChannel = AgentConnection;
    window.Channel = AgentConnection;

    RegExp.quote = RegExp.quote || function(str) {
        return (str+'').replace(/[.?*+^$[\\]\\(){}|-]/g, "\\$&");
    };
    if (!String.prototype.endsWith) {
        String.prototype.endsWith = function(searchString, position) {
            const subjectString = this.toString();
            if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
                position = subjectString.length;
            }
            position -= searchString.length;
            const lastIndex = subjectString.lastIndexOf(searchString, position);
            return lastIndex !== -1 && lastIndex === position;
        };
    }

    if (!String.prototype.startsWith) {
        String.prototype.startsWith = function(searchString, position){
            return this.substr(position || 0, searchString.length) === searchString;
        };
    }

    const Eventable = function(obj){
        if(typeof obj !== 'object' && typeof obj !== 'function' ){
            throw new Error('Object parameter is required');
        }

        const eventable = typeof obj.addEventListener === 'function' && typeof obj.removeEventListener === 'function' && typeof obj.dispatchEvent === 'function';

        if(typeof obj === 'function'){
            obj = obj.prototype;
        }

        if(!eventable){

            obj.addEventListener = function(event,listeners){

                let callbacks = [];
                const eventsMap = (this._eventsMap = (this._eventsMap || {}));

                if(Array.isArray(listeners)){
                    callbacks = listeners;
                }else{
                    callbacks = [listeners];
                }

                for(let i=0;i<callbacks.length;i++){
                    if(typeof callbacks[i] === 'function'){
                        eventsMap[event] = eventsMap[event] || [];
                        eventsMap[event].push(callbacks[i]);
                    }
                }
            }

            obj.removeEventListener = function(event,listeners){

                let callbacks = [];
                const eventsMap = (this._eventsMap = (this._eventsMap || {}));

                if(Array.isArray(listeners)){
                    callbacks = listeners;
                }else{
                    callbacks = [listeners];
                }

                for(let i=0;i<callbacks.length;i++){
                    if(typeof callbacks[i] === 'function'){
                        eventsMap[event] = eventsMap[event] || [];
                        eventsMap[event].splice(eventsMap[event].indexOf(callbacks[i]),1);
                    }
                }
            }

            obj.dispatchEvent = function(event,properties){

                const eventsMap = (this._eventsMap = (this._eventsMap || {}));


                let cancelled = false;
                const e = {
                    type : event,
                    src : this,
                    preventDefault : function(){
                        cancelled = true;
                    }
                }

                if(typeof properties === 'object' && properties != null ){
                    for(const key in properties){
                        if(!e.hasOwnProperty(key)){
                            e[key] = properties[key];
                        } else {
                            throw new Error('Unable to dispatch event '+event+' with property '+key+
                                '. Either the property is duplicate it matches once field of the default event object parameters');
                        }
                    }
                }

                eventsMap[event] = eventsMap[event] || [];
                const callbacks = eventsMap[event];

                let res = false;

                if(typeof this['on'+event] === 'function'){
                    this['on'+event].apply(this,[e]);
                }

                for(let i=0;i<callbacks.length && !cancelled;i++){
                    if(typeof callbacks[i] === 'function'){
                        callbacks[i].apply(this,[e]);
                        res = true;
                    }
                }

                return res && !cancelled;
            }

        }
    }

    AgentConnection.prototype.getSystemAgents = function(callback){
        const _self = this;
        if(!_self.readyState){
            throw new Error('Channel is not ready.');
        }
        const session = _self.sessionId;
        request({
            useSyncMode : _self.useSyncMode,
            pubKeyEncryptor : _self._pubKeyEncryptor,
            base : _self._api,
            apiKey: _self._apiKey,
            method : 'post',
            action : 'list-system-agents',
            payload : { sessionId : session },
            id : _self.channelId,
            callback : function(resp){
                if(resp.status === 'success'){
                    const apiResponse = extractApiResponse(resp);
                    typeof callback === 'function' && callback(apiResponse);
                } else {
                    typeof callback === 'function' && callback(resp);
                }
            }
        });
    }

    // Apply Eventable mixin
    Eventable(AgentConnection);

    // ===== Utility Functions =====

    /**
     * Generate random agent name
     * Returns a random agent name like "HappyFox42"
     * @returns {string} Random agent name
     */
    function generateRandomAgentName() {
        const adjectives = ['Happy', 'Swift', 'Bright', 'Cool', 'Smart', 'Quick', 'Bold', 'Calm', 'Wise', 'Kind'];
        const nouns = ['Fox', 'Eagle', 'Tiger', 'Bear', 'Wolf', 'Hawk', 'Lion', 'Panda', 'Owl', 'Deer'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const num = Math.floor(Math.random() * 100);
        return `${adj}${noun}${num}`;
    }

    // Registry to track all active AgentConnection instances
    const _activeConnections = [];

    /**
     * Register an active connection (called when readyState becomes true)
     * @private
     */
    function _registerConnection(connection) {
        if (_activeConnections.indexOf(connection) === -1) {
            _activeConnections.push(connection);
            console.log('[web-agent.js] Connection registered:', connection.agentName || 'Unknown');
        }
    }

    /**
     * Unregister a connection (called when disconnect completes)
     * @private
     */
    function _unregisterConnection(connection) {
        const index = _activeConnections.indexOf(connection);
        if (index !== -1) {
            _activeConnections.splice(index, 1);
            console.log('[web-agent.js] Connection unregistered:', connection.agentName || 'Unknown');
        }
    }

    // Export to window/global object
    window.AgentConnection = AgentConnection;
    window.MySecurity = MySecurity;
    window.generateRandomAgentName = generateRandomAgentName;
    if (typeof FileSystem !== 'undefined') {
        window.FileSystem = FileSystem;
    }

    // Add beforeunload warning for active connections (browser environment only)
    if (typeof window !== 'undefined' && window.addEventListener) {
        /**
         * Warn user before closing/refreshing page if there are active agent connections
         * This prevents accidental disconnections during collaborative sessions
         *
         * IMPORTANT: In modern browsers, setting e.returnValue triggers the confirmation dialog.
         * If user clicks "Cancel", the page stays open. If "Leave", page closes.
         */
          window.addEventListener('beforeunload', (e) => {
            const activeConnections = _activeConnections;

            if (activeConnections && activeConnections.length > 0) {
              // Required for modern browsers
              e.preventDefault();

              // Chrome, Edge, Firefox ignore custom text
              // Setting returnValue triggers the confirmation dialog
              e.returnValue = '';
              return '';
            }
          })

        console.log('[web-agent.js] Beforeunload listener registered - will warn on page close if connected');
    }

    // Export for Node.js
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            AgentConnection,
            MySecurity,
            FileSystem,
            generateRandomAgentName
        };
    }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {}));
