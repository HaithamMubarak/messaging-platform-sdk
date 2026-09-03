(function(window){
    // used only in case of debugging
    let DISABLE_ENCRYPTION = false;

    // Fallback throttle bucket, used only by requests made outside a connection.
    // Each AgentConnection carries its OWN bucket (see _throttle below): the
    // budget is per connection, not per page, because N agents in one realm
    // used to share one budget and starve each other.
    const globalThrottle = { requests: 0, initialDate: new Date(), enabled: true };
    const requests_limit = 50;
    const requests_time_period = 1500;
    const DEFAULT_RECEIVE_LIMIT = 50;
    // Ceiling for a request with no explicit timeout. Long enough for a
    // long-poll receive, short enough that a dead socket is eventually noticed.
    const DEFAULT_REQUEST_TIMEOUT = 10 * 60 * 1000;

    const channelPasswordRegex = /[*,\/\\\s]+/;

    "use strict";

    /**
     * Log a request payload without logging its secrets.
     *
     * These payloads carry channelPassword, session ids and message content,
     * and they were being written to the console in full on every send and
     * every connect. A browser console is not a private place: extensions read
     * it, screen shares show it, and bug reports paste it.
     */
    function logPayload(label, payload) {
        const SENSITIVE = ['channelPassword', 'password', 'secret', 'channelSecret',
                           'token', 'apiKey', 'privateKey', 'content', 'msg', 'data'];
        let safe;
        try {
            safe = {};
            Object.keys(payload || {}).forEach(function (k) {
                if (SENSITIVE.indexOf(k) !== -1) {
                    const v = payload[k];
                    safe[k] = (v === null || v === undefined || v === '')
                        ? v
                        : '[redacted ' + String(v).length + ' chars]';
                } else {
                    safe[k] = payload[k];
                }
            });
        } catch (e) {
            safe = '[unloggable payload]';
        }
        console.debug(label, safe);
    }

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

        if(!globalThrottle.enabled){
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

    /**
     * Client-side throttle tripped.
     *
     * This used to set a MODULE-GLOBAL xhr_enabled=false for five seconds and
     * then drop the request on the floor — no callback, no onreset. That was
     * fatal rather than merely slow: receive()'s auto-poll re-arms itself
     * inside its callback, so a swallowed request meant the polling loop never
     * re-armed and the connection went permanently deaf while still looking
     * healthy (session valid, readyState true).
     *
     * It was also shared by every AgentConnection in the page, so sixteen
     * agents in one realm shared one budget and tripped it during any join
     * burst — which is exactly how a room of fifteen went silent.
     *
     * Now the caller is always told, so receive()'s existing failure backoff
     * turns a throttle into a few seconds of lag instead of a dead loop.
     */
    function reset(obj, binData, scope){
        const state = scope || globalThrottle;
        state.requests = 0;
        state.enabled = false;
        setTimeout(function(){
            state.enabled = true;
        }, 5000);
        console.warn('[web-agent.js] Client throttle tripped; pausing this connection for 5 seconds.');

        if (obj && typeof obj.onreset === 'function') {
            try { obj.onreset(); } catch (e) { /* a handler must not break the caller */ }
        }
        // Tell the caller, or every loop that re-arms in its callback dies here.
        if (obj && typeof obj.callback === 'function') {
            try {
                obj.callback({ status: 'error', statusMessage: 'client-throttled', data: null });
            } catch (e) { /* as above */ }
        }
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

        // Per-connection when the caller supplies one; the shared bucket only
        // covers the handful of calls made before a connection exists.
        const throttle = (obj && obj._throttle) || globalThrottle;

        if(!throttle.enabled){
            // Still answer the caller. Returning silently here was the second
            // way a polling loop could die without anything looking wrong.
            if (obj && typeof obj.callback === 'function') {
                try {
                    obj.callback({ status: 'error', statusMessage: 'client-throttled', data: null });
                } catch (e) { /* a handler must not break the caller */ }
            }
            return;
        }

        if(typeof obj.retryChances !== 'number'){
            obj.retryChances = 1;
        }

        obj.retryChances--;

        const newDate = new Date();

        if((newDate - throttle.initialDate) < requests_time_period){
            throttle.requests++;
        }else{
            throttle.requests = 0;
            throttle.initialDate = new Date();
        }

        if(throttle.requests > requests_limit){
            return reset(obj, binData, throttle);
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

        // Every call site had its timeout commented out, so a request that was
        // never answered stayed pending for ever and the caller's callback
        // never ran. A ceiling is applied when the caller does not set one; it
        // is deliberately generous so a long-poll receive is not cut short.
        const timeout = parseInt(obj.timeout);
        const effectiveTimeout = (!isNaN(timeout) && timeout > 0) ? timeout : DEFAULT_REQUEST_TIMEOUT;

        if(!obj.useSyncMode && effectiveTimeout > 0){
            xhr.timeout = effectiveTimeout;
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

        logPayload('Sending payload:', payload);

        request({
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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

        logPayload('Sending payload:', payload);

        request({
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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

    // Default transport is WebSocket. Set localStorage.sdkHttpPolling = 'true'
    // (in the browser) to force HTTP polling by default instead — handy for
    // comparing behaviour/message ordering between the two transports. An explicit
    // useWebsocket option passed to the constructor always wins over this.
    function _resolveUseWebsocketDefault() {
        try {
            if (typeof localStorage !== 'undefined' && localStorage.getItem('sdkHttpPolling') === 'true') {
                return false;
            }
        } catch (e) { /* localStorage unavailable (non-browser) */ }

        // Only default to the socket transport where there IS one. Returning
        // true regardless meant that off-browser — Node before it had a global
        // WebSocket, a test harness, a worker without one — the SDK chose a
        // transport it could not open and then never fell back to polling: the
        // connection succeeded, autoReceive was on, and no message ever
        // arrived. HTTP polling works everywhere, so it is the safe default
        // when the socket is not available.
        if (typeof WebSocket === 'undefined') {
            return false;
        }
        return true;
    }

    const AgentConnection = function({usePubKey = false, enableWebrtcRelay = false, useWebsocket = _resolveUseWebsocketDefault()} = {}){

        // This connection's own request budget. It used to be one budget for
        // the whole page, so several agents in one realm starved each other.
        this._throttle = { requests: 0, initialDate: new Date(), enabled: true };

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
        // How many times the socket quietly tries to come back on its own
        // before it admits defeat and tells the page. Settable so a test can
        // reach the giving-up path without waiting a minute for it.
        this._wsMaxReconnectAttempts = 5;
        this._connectionLostDispatched = false;
        // Heartbeat. See _startHeartbeat: a socket can stay open and carry
        // nothing, and that is the failure a phone actually has.
        this._wsHeartbeatMs = 15000;
        this._wsHeartbeatGraceMs = 20000;
        this._wsHeartbeatTimer = null;
        this._lastPongAt = 0;
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

    /**
     * Tell the SDK whether leaving this page would lose work.
     *
     * The unload prompt is driven by this, so it appears for an app with a
     * half-written document and stays out of the way for one that is merely
     * connected. Call it with false again once the work is saved.
     */
    AgentConnection.prototype.setUnsavedChanges = function(hasUnsaved){
        this.hasUnsavedChanges = !!hasUnsaved;
        return this;
    };

    AgentConnection.prototype.getActiveAgents = function(callback){

        const _self = this;

        if(!_self.readyState){
            throw new Error('Channel is not ready.');
        }

        const session = _self.sessionId;

        request({
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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
                /*
                 * Was this a RECONNECT rather than a first connection? The
                 * distinction matters to anything holding shared state: while
                 * the socket was down the channel carried on without this
                 * agent, so what it holds may now be stale. The catch-up
                 * receive below replays what was missed, but an application
                 * that keeps a snapshot (a board, a game, a document) needs to
                 * ask the room for a fresh one, and it can only do that if it
                 * is told the gap happened.
                 *
                 * 'connection-lost' is not that signal: it fires only when the
                 * ladder gives up entirely. A drop that recovers is silent,
                 * and silent is exactly the case that leaves two screens
                 * disagreeing.
                 */
                const reconnected = _self._websocketReconnectAttempts > 0;
                _self._websocketConnected = true;
                _self._websocketReconnectAttempts = 0;
                _self._connectionLostDispatched = false;
                _self._startHeartbeat();

                // Subscribe to receive messages for this session
                _self._websocketSubscribe();

                // One-shot catch-up pull over the socket (no polling loop): grabs
                // anything sent between the HTTP connect and this subscription, and
                // re-syncs after a reconnect. Ongoing delivery is via server push.
                if (_self.autoReceive) {
                    const range = _self._last_receive_range || _self.initialReceiveConfig ||
                        { globalOffset: 0, localOffset: 0, limit: _self.defaultLimit || DEFAULT_RECEIVE_LIMIT };
                    _self.receive(range);
                }

                _self.dispatchEvent('socket-open', { reconnected: reconnected });
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
                _self._socketGone(event && event.reason);
            };

            _self._websocket.onerror = function(error) {
                console.error('[WebSocket] Error:', error);
            };
        } catch (e) {
            console.error('[WebSocket] Failed to connect:', e);
        }
    };

    /**
     * The socket is not there any more, however we found out.
     *
     * Reached from onclose and from the heartbeat, because those are two
     * genuinely different events: a socket that closes tells us, and a socket
     * that dies does not. Either way this runs once — a close event arriving
     * late, after the heartbeat has already given up on the same socket, must
     * not start a second ladder of attempts.
     *
     * @private
     */
    AgentConnection.prototype._socketGone = function(why) {
        const _self = this;

        _self._stopHeartbeat();
        _self._websocketConnected = false;
        if (_self._websocket) {
            try { _self._websocket.onclose = null; _self._websocket.close(); } catch (e) { /* already gone */ }
            _self._websocket = null;
        }

        // Not our channel any more: nothing to come back to.
        if (!_self.readyState) return;

        if (_self._websocketReconnectAttempts < _self._wsMaxReconnectAttempts) {
            _self._websocketReconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, _self._websocketReconnectAttempts), 30000);
            console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${_self._websocketReconnectAttempts})`);
            setTimeout(() => _self._connectWebSocket(), delay);
            return;
        }

        // Out of attempts while the channel still believes it is up.
        //
        // This used to be where the story ended: the socket stopped trying and
        // said nothing, so the page went on showing "connected" for a session
        // that no longer existed. Every app built on this became a zombie
        // after a tunnel, a sleeping laptop or a phone whose browser
        // backgrounded the tab. The page is told now, and can decide to rejoin.
        if (!_self._connectionLostDispatched) {
            _self._connectionLostDispatched = true;
            console.warn('[WebSocket] Giving up after '
                + _self._websocketReconnectAttempts + ' attempts; telling the page'
                + (why ? ' (' + why + ')' : ''));
            _self.dispatchEvent('connection-lost', {
                reason: 'websocket',
                attempts: _self._websocketReconnectAttempts,
                timestamp: Date.now()
            });
        }
    };

    /**
     * Keep asking the socket whether it is still there.
     *
     * A closed socket announces itself; a *dead* one does not. Lose signal in a
     * tunnel, sleep the laptop, walk out of range: the connection stops
     * carrying anything while the browser goes on reporting it as OPEN, so
     * onclose never fires and nothing anywhere notices. That is not the rare
     * case — it is what losing a connection on a phone looks like.
     *
     * So the client pings, and the server has always answered pong; nobody was
     * asking. If the answers stop for longer than the grace period the socket
     * is closed deliberately, which puts it back on the ordinary reconnect
     * path and, if that fails too, ends in the page being told.
     *
     * @private
     */
    AgentConnection.prototype._startHeartbeat = function() {
        const _self = this;
        _self._stopHeartbeat();
        _self._lastPongAt = Date.now();

        _self._heartbeatRanAt = Date.now();

        _self._wsHeartbeatTimer = setInterval(function() {
            if (!_self._websocket || _self._websocket.readyState !== WebSocket.OPEN) return;

            // A timer that did not run is not evidence that the network died.
            //
            // This interval is the only thing measuring the silence, so when
            // the main thread is blocked — a game building its world, a tab
            // frozen in the background, a laptop lid closed and reopened — it
            // stops firing, the pong it was waiting for is never processed, and
            // on the next tick the whole stall is counted as silence. The
            // socket is then declared dead and torn down, taking any WebRTC
            // negotiation in flight with it, while the network was fine
            // throughout.
            //
            // So ask first whether *we* were the ones missing. If this tick is
            // late by more than a period, the gap was ours: forgive the
            // silence, let the ping below prove the socket either way, and
            // decide on the next tick with an honest measurement.
            const now = Date.now();
            const lateBy = now - (_self._heartbeatRanAt || now) - _self._wsHeartbeatMs;
            _self._heartbeatRanAt = now;

            const silence = now - _self._lastPongAt;
            if (silence > _self._wsHeartbeatGraceMs) {
                // Give it one more period before pronouncing. A long stall does
                // not arrive as one late tick — a game building its world blocks
                // in bursts, so each tick looks only a second or two late while
                // the silence between them adds up to the whole grace period.
                // Measuring lateness per tick cannot see that; asking again can.
                //
                // So on the first suspicion, send a ping and wait one more
                // round. If the socket is really gone the next tick finds the
                // same silence and says so; if we were merely blocked, the
                // answer lands in between and clears it. The cost of being
                // wrong here is tearing down a live connection and any WebRTC
                // negotiation riding on it, so it is worth one more period.
                if (!_self._deathSuspectedAt) {
                    _self._deathSuspectedAt = now;
                    console.warn('[WebSocket] No answer for ' + silence + 'ms (late by ' +
                        Math.max(0, lateBy) + 'ms) — asking once more before giving up');
                    try {
                        _self._websocket.send(JSON.stringify({ action: 'ping', sessionId: _self.sessionId }));
                    } catch (e) { /* the next tick will judge it */ }
                    return;
                }
                // Closing it is not enough to be told about it: a close
                // handshake on a network that is no longer there never
                // completes, so onclose may never fire. This declares it.
                console.warn('[WebSocket] No answer for ' + silence + 'ms — the socket is open but dead');
                _self._deathSuspectedAt = null;
                _self._socketGone('heartbeat timeout');
                return;
            }
            _self._deathSuspectedAt = null;

            try {
                _self._websocket.send(JSON.stringify({
                    action: 'ping',
                    sessionId: _self.sessionId
                }));
            } catch (e) {
                console.warn('[WebSocket] Heartbeat could not be sent:', e && e.message);
            }
        }, _self._wsHeartbeatMs);
    };

    /** @private */
    AgentConnection.prototype._stopHeartbeat = function() {
        if (this._wsHeartbeatTimer) {
            clearInterval(this._wsHeartbeatTimer);
            this._wsHeartbeatTimer = null;
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
            offset: _self._last_receive_range ? _self._last_receive_range.globalOffset : 0,
            // Send the per-channel offset too: the server's push path reads the
            // cache by localOffset, so it must seed that cursor, not just global.
            localOffset: _self._last_receive_range ? _self._last_receive_range.localOffset : 0
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
                // Heartbeat response — proof the socket is carrying traffic in
                // both directions, which is the only thing that proves it.
                _self._lastPongAt = Date.now();
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
     * Per-item auto-handling shared by both receive transports: presence
     * (connect/disconnect), WebRTC signaling and the password exchange. The HTTP
     * polling receive() and the WebSocket push handler both call this so a
     * message triggers the exact same handling however it arrived.
     * @private
     */
    /**
     * Stable signature identifying a single logical message, so re-deliveries
     * collapse to one. WebSocket delivers each event via BOTH the on-open
     * catch-up pull AND the ongoing server push, and a broadcast can fan out
     * more than once; without dedup the WebRTC answerer receives the same
     * offer twice and builds a SECOND RTCPeerConnection for the same stream,
     * fragmenting ICE so the DataChannel never opens.
     *
     * Persistent events carry a monotonic offset (unique). Ephemeral events
     * (webrtc-signaling, connect/disconnect, presence) have none, so we key on
     * sender + target + type + the sender's ms timestamp + a content hash:
     * identical across re-deliveries, distinct across genuinely different
     * messages (even two ICE candidates in the same millisecond differ in
     * content).
     * @private
     */
    AgentConnection.prototype._messageSignature = function(item) {
        try {
            if (!item) return null;
            if (item.offset !== undefined && item.offset !== null && !item.ephemeral) {
                return 'o:' + item.offset;
            }
            let content = item.content !== undefined ? item.content : item.data;
            if (content && typeof content !== 'string') {
                try { content = JSON.stringify(content); } catch (e) { content = String(content); }
            }
            const s = String(content || '');
            let hash = 0;
            for (let i = 0; i < s.length; i++) {
                hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
            }
            return 'e:' + item.from + '|' + item.to + '|' + item.type + '|' + item.date + '|' + s.length + '|' + hash;
        } catch (e) {
            return null;
        }
    };

    /**
     * True the first time an item is seen and false thereafter. Bounded FIFO
     * cache so long-lived sessions don't grow unbounded.
     * @private
     */
    AgentConnection.prototype._isDuplicateReceivedItem = function(item) {
        const _self = this;
        const sig = _self._messageSignature(item);
        if (sig === null) return false; // can't identify — don't drop
        if (!_self._seenMessageSignatures) _self._seenMessageSignatures = new Map();
        const seen = _self._seenMessageSignatures;
        if (seen.has(sig)) return true;
        seen.set(sig, 1);
        const MAX_SEEN = 2000;
        if (seen.size > MAX_SEEN) {
            seen.delete(seen.keys().next().value);
        }
        return false;
    };

    // Returns true if the item was handled, false if it was dropped as a
    // duplicate re-delivery (callers should then skip it entirely).
    AgentConnection.prototype._autoHandleReceivedItem = function(item) {
        const _self = this;
        if (_self._isDuplicateReceivedItem(item)) {
            return false;
        }
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

                    // The context on a disconnect is optional and is not always
                    // JSON — an empty body is normal. Parsing it unguarded threw
                    // before the event was dispatched, so nobody was ever told
                    // the agent had left: every roster on the channel kept a
                    // ghost until something else happened to correct it. The
                    // connect branch above already parses defensively; this is
                    // the same care.
                    let parsedContent = null;
                    try {
                        if (item.content) {
                            parsedContent = JSON.parse(item.content);
                        }
                    } catch (e) {
                        console.warn('Failed to parse context from DISCONNECT event:', e.message);
                    }

                    _self.dispatchEvent('agent-disconnect', {
                        agentName: item.from,
                        timestamp: item.date,
                        systemEvent: item.systemEvent,
                        agentContext: (parsedContent && (parsedContent.agentContext || parsedContent.metadata)) || null,
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
        return true;
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

            // Same handling as the HTTP polling receive() path. Skip
            // duplicate re-deliveries so the app sees each message once.
            if (!_self._autoHandleReceivedItem(item)) {
                continue;
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
    AgentConnection.prototype._websocketSend = function(action, payload, callback, timeoutMs) {
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
            // Timeout for callback. Callers with a fallback path pass a shorter
            // one: thirty seconds is not a wait, it is a lost message.
            setTimeout(() => {
                if (_self._websocketMessageCallbacks.has(messageId)) {
                    _self._websocketMessageCallbacks.delete(messageId);
                    callback({ status: 'error', statusMessage: 'WebSocket request timeout' });
                }
            }, timeoutMs || 30000);
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
            _self._stopHeartbeat();
            _self._websocketReconnectAttempts = _self._wsMaxReconnectAttempts; // Prevent reconnect
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
        // Kept so isHostAgent() can scope its election to agents running the
        // same app. The server already stamps this onto AgentInfo and
        // broadcasts it, so every peer's tag arrives with its connectionTime.
        _self.customEventType = customEventType || '';
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

        logPayload('Connect payload:', payload);

        request({
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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

                // Start auto-receive if enabled.
                if(autoReceive){
                    _self.autoReceive = autoReceive;
                    // HTTP mode polls here. WebSocket mode does NOT poll: it catches
                    // up with a single pull when the socket opens (see
                    // _connectWebSocket) and then receives via server push.
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
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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

        // Clear any pending HTTP-polling tick (e.g. from before the socket came up).
        clearTimeout(_self._receiveTimer);

        // WebSocket mode: NO polling loop. Ongoing messages arrive via server
        // push. We only pull ONCE here (over the socket, same 'pull' action +
        // same server receive() + same handler as HTTP) to catch up on anything
        // that raced the subscribe — e.g. a WebRTC offer sent the instant a peer
        // joined, before its socket finished subscribing.
        if (useWebsocket && _self._websocketConnected) {
            const wsReceiveConfig = { ...range, pollSource: range.pollSource || _self.defaultPollSource };
            _self._websocketSend('pull', { receiveConfig: wsReceiveConfig }, function(response) {
                try {
                    if (response && response.status === 'success' && response.data) {
                        _self._processReceivedMessages(response);
                        const d = response.data;
                        _self._last_receive_range = {
                            globalOffset: (d.nextGlobalOffset != null) ? d.nextGlobalOffset : range.globalOffset,
                            localOffset: (d.nextLocalOffset != null) ? d.nextLocalOffset : range.localOffset,
                            limit: range.limit,
                        };
                    }
                } catch (e) {
                    console.error('[WebSocket] Error processing pull response:', e);
                }
                // No setTimeout re-arm — push delivers the rest.
            });
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
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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

                        // Same handling as the WebSocket push path. Skip
                        // duplicate re-deliveries so the app sees each once.
                        if (!_self._autoHandleReceivedItem(item)) {
                            continue;
                        }

                        dataArray.push(item);
                    }

                    // Updates offsets for next receive.
                    // `||` was wrong here: 0 is a legitimate offset — it is
                    // where a freshly reset channel starts — and `||` treated
                    // it as absent, so the client kept a stale position and
                    // re-read or stalled. Only null/undefined mean "unchanged".
                    if (data.nextGlobalOffset !== null && data.nextGlobalOffset !== undefined) {
                        range.globalOffset = data.nextGlobalOffset;
                    }
                    if (data.nextLocalOffset !== null && data.nextLocalOffset !== undefined) {
                        range.localOffset = data.nextLocalOffset;
                    }
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
                        additionalTimeout = typeof _self.autoReceive === 'number' ? _self.autoReceive : 1000;
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
                    clearTimeout(_self._receiveTimer);
                    _self._receiveTimer = setTimeout(function(){
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

        logPayload('Sending payload:', payload);

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
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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
    /**
     * List every stored version of a key, decrypting as storageGet does.
     *
     * storageGet auto-decrypts when the server says the value was encrypted;
     * this path did not, so it handed back the raw {cipher, hash} envelope,
     * base64-encoded. Anything written with encrypted:true was therefore
     * unreadable through the list API — the versions were all there and none of
     * them could be used, which looks exactly like an empty history rather than
     * like a bug.
     *
     * Each version is decrypted independently: one unreadable entry (written
     * under a different channel password, say) leaves the rest usable and is
     * marked rather than throwing the whole list away.
     */
    AgentConnection.prototype.storageGetList = function(storageKey, callback){
        const _self = this;
        this._storageRequest('getList', storageKey, function (response) {
            if (!response || response.status !== 'success') {
                typeof callback === 'function' && callback(response);
                return;
            }

            // The versions sit a couple of levels down, and the shape varies.
            let payload = response.data && response.data.data ? response.data.data : response.data;
            const versions = payload && Array.isArray(payload.versions)
                ? payload.versions
                : (Array.isArray(payload) ? payload : null);

            if (versions && _self._channelSecret) {
                versions.forEach(function (entry) {
                    if (!entry || typeof entry.content !== 'string') return;
                    try {
                        // Stored content is base64 of the envelope decryptAndVerify expects.
                        const envelope = atob(entry.content);
                        const plain = MySecurity.decryptAndVerify(envelope, _self._channelSecret);
                        if (plain === null || plain === undefined) return;
                        entry.encrypted = false;
                        try {
                            entry.content = JSON.parse(plain);
                        } catch (e) {
                            entry.content = plain;
                        }
                    } catch (e) {
                        // Not ours to read: leave it as it came and say so, so a
                        // caller can skip it rather than mistake it for content.
                        entry.unreadable = true;
                    }
                });
            }

            typeof callback === 'function' && callback(response);
        });
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

    // ---- Attest: hash-chain receipts --------------------------------------
    //
    // The server witnesses only what a server honestly can -- the ORDER of
    // records, its own clock, and the authenticated agent -- and signs that.
    // The content never leaves your machine: you hash it here and send the
    // hash. Everything below is the client half of that bargain, including a
    // verifier that re-derives a chain with no help from the platform.

    function attestUrl(apiBase, endpoint){
        let baseUrl = apiBase || '';
        if(baseUrl.endsWith('/')){
            baseUrl = baseUrl.substring(0, baseUrl.length - 1);
        }
        return `${baseUrl}/attest/${endpoint}`;
    }

    /**
     * Stable JSON: same object, same string, same hash, everywhere, next year.
     *
     * This MUST stay byte-identical to AttestCrypto.canonical() on the server
     * and to canonical() in the evidence-chain demo. JSON.stringify alone is
     * not stable -- key order follows insertion -- and a chain whose canonical
     * form drifts is a chain that stops verifying with no error to read.
     */
    function attestCanonical(obj){
        if(obj === null || typeof obj !== 'object') return JSON.stringify(obj);
        if(Array.isArray(obj)) return '[' + obj.map(attestCanonical).join(',') + ']';
        return '{' + Object.keys(obj).sort().map(function(k){
            return JSON.stringify(k) + ':' + attestCanonical(obj[k]);
        }).join(',') + '}';
    }

    function attestSha256Hex(bytesOrText){
        const data = typeof bytesOrText === 'string'
            ? new TextEncoder().encode(bytesOrText)
            : bytesOrText;
        return crypto.subtle.digest('SHA-256', data).then(function(digest){
            return Array.prototype.slice.call(new Uint8Array(digest)).map(function(b){
                return b.toString(16).padStart(2, '0');
            }).join('');
        });
    }

    function attestB64ToBytes(b64){
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    /**
     * Hash content the way Attest expects. Exposed because an app should never
     * have to guess how its own receipt was computed.
     * @param {string|ArrayBuffer|Uint8Array} content
     * @returns {Promise<string>} lowercase hex SHA-256
     */
    AgentConnection.prototype.attestHash = function(content){
        return attestSha256Hex(content);
    }

    /**
     * Append one record to a chain (created on first use).
     * @param {object} options - {chainKey, kind, contentHash, meta}
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.attest = function(options, callback){
        const _self = this;
        const {chainKey, kind, contentHash, meta = null} = options || {};

        if(!_self.readyState || !_self.sessionId){
            typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
            return;
        }

        _self._attestPost('append', {
            chainKey : chainKey,
            kind : kind,
            contentHash : contentHash,
            meta : meta
        }, callback);
    }

    /**
     * Read a chain back, oldest first, with the genesis and public keys needed
     * to verify it.
     * @param {string} chainKey
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.attestList = function(chainKey, callback){
        this._attestPost('list', {chainKey : chainKey}, callback);
    }

    /**
     * A self-contained bundle: chain, genesis, rule, and key. The server walks
     * the chain before issuing one and refuses a bundle it knows is broken.
     * @param {string} chainKey
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.attestExport = function(chainKey, callback){
        this._attestPost('export', {chainKey : chainKey}, callback);
    }

    /**
     * Every chain name in this channel.
     * @param {function} callback - Callback function(response)
     */
    AgentConnection.prototype.attestChains = function(callback){
        this._attestPost('chains', {}, callback);
    }

    /**
     * Re-derive a chain and check every signature. Deliberately takes plain
     * data rather than talking to the platform: this is what makes an exported
     * receipt outlive us. Feed it a bundle from a file and it still answers.
     *
     * @param {object} bundle - {channelId, chainKey, genesis, records, publicKeys}
     * @returns {Promise<object>} {ok:true, length} | {ok:false, brokenAt, reason}
     */
    AgentConnection.attestVerify = async function(bundle){
        const records = (bundle && bundle.records) || [];
        const keys = (bundle && bundle.publicKeys) || [];
        if(!bundle || !bundle.genesis){
            return {ok : false, brokenAt : null, reason : 'bundle has no genesis to start from'};
        }

        // Import each published key once, by kid.
        const byKid = {};
        for(const k of keys){
            try {
                byKid[k.kid] = await crypto.subtle.importKey(
                    'spki', attestB64ToBytes(k.publicKey),
                    {name : 'ECDSA', namedCurve : 'P-256'}, false, ['verify']);
            } catch(e) {
                return {ok : false, brokenAt : null, reason : 'could not import key ' + k.kid};
            }
        }

        let prev = bundle.genesis;
        for(let i = 0; i < records.length; i++){
            const r = records[i];

            if(r.prev !== prev){
                return {ok : false, brokenAt : i, reason : 'prev does not match the previous record\'s chain'};
            }

            // The stamp is rebuilt, not trusted: if a stored agent name or time
            // were altered, the chain value below stops matching.
            const stamp = attestCanonical({agent : r.stamp.agent, serverTime : r.stamp.serverTime});
            const expect = await attestSha256Hex(r.prev + '|' + r.contentHash + '|' + stamp);
            if(expect !== r.chain){
                return {ok : false, brokenAt : i, reason : 'chain value does not match its own contents'};
            }

            const key = byKid[r.kid];
            if(!key){
                return {ok : false, brokenAt : i, reason : 'no published key with kid ' + r.kid};
            }
            const sigOk = await crypto.subtle.verify(
                {name : 'ECDSA', hash : 'SHA-256'}, key,
                attestB64ToBytes(r.sig),
                new TextEncoder().encode(r.chain));
            if(!sigOk){
                return {ok : false, brokenAt : i, reason : 'signature does not verify against the published key'};
            }

            prev = r.chain;
        }
        return {ok : true, length : records.length};
    }

    /** Shared POST for the attest endpoints. @private */
    AgentConnection.prototype._attestPost = function(endpoint, body, callback){
        const _self = this;

        if(!_self.readyState || !_self.sessionId){
            typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
            return;
        }

        const payload = Object.assign({sessionId : _self.sessionId}, body || {});

        const xhr = new XMLHttpRequest();
        xhr.open('POST', attestUrl(_self._api, endpoint));
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onload = function() {
            // 201 on append, 200 on the reads.
            if (xhr.status === 200 || xhr.status === 201) {
                try {
                    typeof callback === 'function' && callback(JSON.parse(xhr.responseText));
                } catch(e) {
                    typeof callback === 'function' && callback({status: 'error', data: 'Invalid response'});
                }
            } else {
                let msg = xhr.responseText || xhr.statusText;
                try { msg = (JSON.parse(xhr.responseText).statusMessage) || msg; } catch(e) {}
                typeof callback === 'function' && callback({status: 'error', data: msg, statusMessage: msg});
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
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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

        // No peer specified: who is host of THIS APP.
        const host = this.getHostAgentName();
        return host === null || host === this.agentName;
    }

    /**
     * The agent this connection considers host, or null if there is nobody.
     *
     * Election is scoped to the app when it safely can be. A channel holds one
     * room, but several apps may sit in it once a channel is shared across
     * them -- and "first agent in the channel" then elects a whiteboard user
     * as the host of a chess game, so the game has no host at all and the
     * whiteboard's own host-only storage writes never run.
     *
     * The scoping is off unless it is certainly safe:
     *
     *  - this connection declared no customEventType (it did not opt in), or
     *  - ANY agent in the room is untagged, so we cannot tell what it is
     *    running,
     *
     * then election stays channel-wide, exactly as before. The second rule is
     * what prevents a split brain: an untagged peer on an older build elects
     * channel-wide, so everyone else must too, or two agents would each
     * believe they were host.
     */
    AgentConnection.prototype.getHostAgentName = function() {
        const agentsInfo = this._connectedAgentsMap || {};
        const agentNames = Object.keys(agentsInfo);
        if (agentNames.length === 0) return null;

        const mine = this.customEventType || '';
        const everyoneTagged = agentNames.every((n) => {
            const i = agentsInfo[n];
            return i && typeof i.customEventType === 'string' && i.customEventType !== '';
        });

        const candidates = (mine && everyoneTagged)
            ? agentNames.filter((n) => agentsInfo[n].customEventType === mine)
            : agentNames;
        if (candidates.length === 0) return null;

        // Earliest connectionTime wins; equal times fall back to alphabetical,
        // which is the tiebreaker the pairwise check above already uses.
        let host = null, hostTime = Infinity;
        candidates.forEach((name) => {
            const t = agentsInfo[name] && agentsInfo[name].connectionTime;
            if (typeof t !== 'number') return;
            if (t < hostTime || (t === hostTime && host !== null && name < host)) {
                hostTime = t;
                host = name;
            }
        });
        // Nobody had a usable connectionTime: fall back to alphabetical order
        // rather than declaring the room hostless.
        if (host === null) host = candidates.slice().sort()[0];
        return host;
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

        // One logical send carries one id, and the HTTP retry below reuses this
        // same payload — so a frame that arrives twice (socket slow to ack, but
        // delivered anyway) is recognisable as the same send and dropped by the
        // receiver. A deliberate re-offer is a new send with a new id, so it
        // still gets through: this suppresses the transport's duplicate, not
        // the application's retry.
        _self._sigSeq = (_self._sigSeq || 0) + 1;
        const tagged = Object.assign({}, signalingMsg, {
            __sigId: (_self.agentName || 'a') + '-' + Date.now() + '-' + _self._sigSeq
        });

        const payload = {
            type: 'webrtc-signaling',
            ephemeral: true,  // Mark as ephemeral to avoid storage
            to: remoteAgent,
            filter: filter,  // Add filter support
            encrypted: false,
            content: JSON.stringify(tagged),
            sessionId: _self.sessionId,
        };

        const overHttp = function() {
            request({
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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
        };

        // Prefer the WebSocket transport when connected (same as sendMessage),
        // fall back to HTTP push otherwise. Either way the server broadcasts it
        // to the recipient's socket.
        //
        // The fallback is not only for a socket that is down. A signaling frame
        // that goes into an open socket and is never acknowledged used to be
        // lost outright: the offer never arrived, the answer never came, and
        // the connection sat in 'new' for ever while the two ends went on
        // exchanging ICE candidates for a session one of them had never heard
        // of. Large offers are the ones this happens to. So an unacknowledged
        // send is repeated over HTTP, and it is given four seconds to be
        // acknowledged rather than thirty, because an offer that arrives half a
        // minute late has already been given up on.
        if (_self.useWebsocket && _self._websocketConnected) {
            const sent = _self._websocketSend('push', payload, function(response) {
                if (response && response.status === 'success') return;
                console.warn('[Channel] WebRTC signaling was not acknowledged on the socket, '
                    + 'sending it again over HTTP:', response && response.statusMessage);
                overHttp();
            }, 4000);
            if (sent === false) overHttp();
            return;
        }

        overHttp();
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

            // Drop a frame the transport delivered twice. Applying the same
            // offer or answer a second time puts the peer connection into a
            // state it never leaves — it sits in 'connecting' while both ends
            // go on trading ICE candidates and no media ever flows.
            const sigId = signalingMsg && signalingMsg.__sigId;
            if (sigId) {
                this._seenSigIds = this._seenSigIds || [];
                this._seenSigSet = this._seenSigSet || {};
                if (this._seenSigSet[sigId]) return;
                this._seenSigSet[sigId] = true;
                this._seenSigIds.push(sigId);
                if (this._seenSigIds.length > 500) {
                    delete this._seenSigSet[this._seenSigIds.shift()];
                }
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

                // Each listener is isolated. One that throws used to abort the
                // whole dispatch and unwind into the SDK's own caller, so a
                // single bad handler silently cost every later listener its
                // event and cost the SDK the work it had queued after the
                // dispatch. This is how the DOM behaves: report and carry on.
                const report = (err) => {
                    console.error('Listener for event \'' + event + '\' threw:', err);
                };

                if(typeof this['on'+event] === 'function'){
                    try {
                        this['on'+event].apply(this,[e]);
                    } catch (err) {
                        report(err);
                    }
                }

                for(let i=0;i<callbacks.length && !cancelled;i++){
                    if(typeof callbacks[i] === 'function'){
                        try {
                            callbacks[i].apply(this,[e]);
                        } catch (err) {
                            report(err);
                        }
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
            _throttle: (typeof _self !== 'undefined' && _self && _self._throttle) || undefined,
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
    // Test for a REAL DOM, and nothing weaker.
    //
    // Two decoys make the obvious checks pass under Node: this module is
    // invoked with `global` when there is no window, and Node has had
    // globalThis.addEventListener since v15; and loading the bundled browser
    // libraries installs a stub `document` carrying only addEventListener and
    // removeEventListener. So both `window.addEventListener` and
    // `typeof document !== 'undefined'` are true in a plain `require()`, and
    // the SDK used to register browser lifecycle handlers that can never fire
    // and announce it on every import.
    //
    // `document.createElement` is the thing the stub does not have.
    if (typeof document !== 'undefined' && typeof document.createElement === 'function'
        && typeof window !== 'undefined' && window.addEventListener) {
        /**
         * Warn user before closing/refreshing page if there are active agent connections
         * AND automatically disconnect all connections when page unloads
         *
         * This prevents:
         * - Accidental disconnections during collaborative sessions (via confirmation)
         * - Orphaned connections on the server (via auto-disconnect)
         *
         * Applications no longer need to implement their own beforeunload handlers!
         *
         * IMPORTANT: In modern browsers, setting e.returnValue triggers the confirmation dialog.
         * If user clicks "Cancel", the page stays open. If "Leave", page closes and disconnects.
         */
        window.addEventListener('beforeunload', (e) => {
            const activeConnections = _activeConnections.slice(); // Copy array to avoid modification during iteration

            // Warn only when leaving would actually lose something.
            //
            // This used to fire whenever any connection was open, which meant
            // every page built on the SDK nagged on every close — including
            // read-only ones with nothing to save. A prompt that always appears
            // is one people learn to dismiss without reading, so it stops
            // protecting the case that matters.
            //
            // An app marks real unsaved work with
            // connection.setUnsavedChanges(true).
            const unsaved = activeConnections.filter(c => c && c.hasUnsavedChanges);

            if (unsaved.length > 0) {
                console.debug(`[web-agent.js] Beforeunload: ${unsaved.length} connection(s) report unsaved work`);

                // Required for modern browsers; the custom text is ignored.
                e.preventDefault();
                e.returnValue = '';

                // The disconnect itself happens on pagehide, because
                // beforeunload can be cancelled by the user.
                return '';
            }
        });

        /**
         * Additional cleanup for mobile browsers and bfcache scenarios
         * pagehide event is more reliable than unload on mobile
         */
        window.addEventListener('pagehide', () => {
            const activeConnections = _activeConnections.slice();

            if (activeConnections.length > 0) {
                console.log(`[web-agent.js] Pagehide: Disconnecting ${activeConnections.length} active connection(s)...`);

                activeConnections.forEach((connection, index) => {
                    try {
                        const agentName = connection.agentName || `Connection-${index}`;
                        connection.disconnect({ useBeacon: true });
                    } catch (error) {
                        console.error('[web-agent.js] Error disconnecting connection:', error);
                    }
                });
            }
        });

        console.debug('[web-agent.js] Beforeunload/pagehide listeners registered - pagehide performs beacon cleanup');
    }

    // ---- Vault: encrypted blobs past the 512 KB line -----------------------
    //
    // SAY THE RIGHT SENTENCE. Dead Drop's promise is "never on a server".
    // Vault's promise is "never READABLE by the server" -- the ciphertext IS
    // stored, and the key is made here and never sent. That is a weaker claim
    // than the one this platform makes everywhere else, and a product adopts
    // it deliberately and repeats the second sentence, or it does not adopt it.
    //
    // Everything below encrypts BEFORE anything leaves the page: each chunk is
    // sealed with AES-256-GCM under a key this file generates, and the server
    // is handed ciphertext and a hash of that ciphertext. It can check that
    // what it stored is what it was given. It can check nothing else, because
    // it has nothing else.

    const VAULT_CHUNK_BYTES = 256 * 1024;

    function vaultUrl(apiBase, endpoint){
        let baseUrl = apiBase || '';
        if(baseUrl.endsWith('/')){
            baseUrl = baseUrl.substring(0, baseUrl.length - 1);
        }
        return `${baseUrl}/vault/${endpoint}`;
    }

    function vaultB64(bytes){
        let binary = '';
        const view = new Uint8Array(bytes);
        for(let i = 0; i < view.length; i++){
            binary += String.fromCharCode(view[i]);
        }
        return window.btoa(binary);
    }

    function vaultFromB64(text){
        const binary = window.atob(text);
        const out = new Uint8Array(binary.length);
        for(let i = 0; i < binary.length; i++){
            out[i] = binary.charCodeAt(i);
        }
        return out;
    }

    async function vaultSha256Hex(bytes){
        const digest = await window.crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest))
            .map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * A fresh key for one blob.
     *
     * Per blob, not per channel: a key that opens everything is a key whose
     * loss opens everything. The caller gets it back and decides who to give
     * it to -- exactly as dead-drop does with its link.
     */
    AgentConnection.prototype.vaultNewKey = async function(){
        const key = await window.crypto.subtle.generateKey(
            {name : 'AES-GCM', length : 256}, true, ['encrypt', 'decrypt']);
        const raw = await window.crypto.subtle.exportKey('raw', key);
        return vaultB64(raw);
    };

    async function vaultImportKey(base64Key){
        return window.crypto.subtle.importKey(
            'raw', vaultFromB64(base64Key), {name : 'AES-GCM'}, false, ['encrypt', 'decrypt']);
    }

    /**
     * Upload a Blob or ArrayBuffer, encrypted, in chunks, resumably.
     *
     *     const {blobId, key} = await channel.vaultPut(file, {
     *         ttlSeconds : 3600,
     *         onProgress : p => bar.style.width = (p.sent / p.total * 100) + '%'
     *     });
     *
     * Returns the blob id AND the key. The key is never sent anywhere; losing
     * it means the bytes are gone, which is the point.
     *
     * Each chunk carries its own 12-byte IV, prefixed to its ciphertext. A
     * shared IV across chunks under one key would be a textbook GCM failure --
     * two ciphertexts under the same key and nonce leak their XOR.
     */
    AgentConnection.prototype.vaultPut = async function(source, options){
        const _self = this;
        const opts = options || {};

        if(!_self.readyState || !_self.sessionId){
            throw new Error('The channel is not ready.');
        }

        const data = source instanceof ArrayBuffer
            ? new Uint8Array(source)
            : new Uint8Array(await source.arrayBuffer());

        const keyB64 = opts.key || await _self.vaultNewKey();
        const key = await vaultImportKey(keyB64);

        // Encrypt everything first: the server is told a size and a hash up
        // front, and both must describe the CIPHERTEXT, which is longer than
        // the plaintext by an IV and a tag per chunk.
        const sealed = [];
        for(let offset = 0; offset < data.length; offset += VAULT_CHUNK_BYTES){
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const slice = data.subarray(offset, Math.min(offset + VAULT_CHUNK_BYTES, data.length));
            const cipher = new Uint8Array(await window.crypto.subtle.encrypt(
                {name : 'AES-GCM', iv : iv}, key, slice));
            const chunk = new Uint8Array(iv.length + cipher.length);
            chunk.set(iv, 0);
            chunk.set(cipher, iv.length);
            sealed.push(chunk);
        }
        if(!sealed.length){
            throw new Error('Nothing to store.');
        }

        const totalBytes = sealed.reduce((sum, c) => sum + c.length, 0);
        const joined = new Uint8Array(totalBytes);
        let at = 0;
        for(const chunk of sealed){
            joined.set(chunk, at);
            at += chunk.length;
        }
        const sha256 = await vaultSha256Hex(joined);

        const begun = await new Promise(resolve => _self._vaultPost('begin', {
            sizeBytes : totalBytes,
            chunkCount : sealed.length,
            sha256 : sha256,
            quotaTag : opts.quotaTag || null,
            ttlSeconds : opts.ttlSeconds || null
        }, resolve));
        if(!begun || begun.status !== 'success'){
            throw new Error((begun && (begun.statusMessage || begun.data)) || 'Could not begin the upload.');
        }
        const blobId = begun.data.blobId;

        const sent = await _self._vaultSendChunks(blobId, sealed, opts.onProgress);

        const done = await new Promise(resolve => _self._vaultPost('complete', {blobId : blobId}, resolve));
        if(!done || done.status !== 'success'){
            throw new Error((done && (done.statusMessage || done.data)) || 'The upload did not complete.');
        }
        return {blobId : blobId, key : keyB64, sizeBytes : totalBytes,
                chunkCount : sealed.length, sha256 : sha256, sent : sent};
    };

    /**
     * Resume an upload that was interrupted.
     *
     * Ask what arrived, send only what did not. The re-sent chunk that was in
     * flight when the connection died is accepted rather than rejected -- if
     * it were an error, resume would be the thing that breaks resume.
     */
    AgentConnection.prototype._vaultSendChunks = async function(blobId, sealed, onProgress){
        const _self = this;
        const state = await new Promise(resolve => _self._vaultPost('status', {blobId : blobId}, resolve));
        const missing = (state && state.data && state.data.missing) || sealed.map((_, i) => i);
        const already = sealed.length - missing.length;
        let sent = 0;

        for(const seq of missing){
            await _self._vaultPutChunk(blobId, seq, sealed[seq]);
            sent++;
            typeof onProgress === 'function' && onProgress({
                sent : already + sent, total : sealed.length, seq : seq
            });
        }
        return sent;
    };

    AgentConnection.prototype._vaultPutChunk = function(blobId, seq, bytes){
        const _self = this;
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', vaultUrl(_self._api, 'chunk'));
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.setRequestHeader('X-Session-Id', _self.sessionId);
            xhr.setRequestHeader('X-Blob-Id', blobId);
            xhr.setRequestHeader('X-Chunk-Seq', String(seq));
            xhr.onload = function(){
                if(xhr.status === 200){
                    resolve();
                } else {
                    let msg = xhr.responseText || xhr.statusText;
                    try { msg = JSON.parse(xhr.responseText).statusMessage || msg; } catch(e) {}
                    reject(new Error('Chunk ' + seq + ': ' + msg));
                }
            };
            xhr.onerror = function(){ reject(new Error('Chunk ' + seq + ': network error')); };
            xhr.send(bytes);
        });
    };

    /**
     * Download and decrypt, chunk by chunk.
     *
     *     const bytes = await channel.vaultGet(blobId, key, {
     *         onProgress : p => ...
     *     });
     *
     * Chunks are fetched in order and decrypted as they arrive, so peak memory
     * is one chunk plus the output -- not two copies of the whole file, which
     * is the ceiling Drop Pro hit at 1.5 GB.
     */
    AgentConnection.prototype.vaultGet = async function(blobId, base64Key, options){
        const _self = this;
        const opts = options || {};

        const state = await new Promise(resolve => _self._vaultPost('status', {blobId : blobId}, resolve));
        if(!state || state.status !== 'success'){
            throw new Error((state && (state.statusMessage || state.data)) || 'No such blob.');
        }
        if(!state.data.complete){
            // A blob that never finished uploading is not a shorter blob. It
            // is an incomplete one, and handing back what arrived would be
            // handing back garbage that decrypts to nothing.
            throw new Error('That blob was never completed.');
        }

        const key = await vaultImportKey(base64Key);
        const parts = [];
        for(let seq = 0; seq < state.data.chunkCount; seq++){
            const cipher = await _self._vaultReadChunk(blobId, seq);
            const iv = cipher.subarray(0, 12);
            const body = cipher.subarray(12);
            const plain = new Uint8Array(await window.crypto.subtle.decrypt(
                {name : 'AES-GCM', iv : iv}, key, body));
            parts.push(plain);
            typeof opts.onProgress === 'function' && opts.onProgress({
                received : seq + 1, total : state.data.chunkCount
            });
        }

        const size = parts.reduce((sum, p) => sum + p.length, 0);
        const out = new Uint8Array(size);
        let at = 0;
        for(const part of parts){
            out.set(part, at);
            at += part.length;
        }
        return out;
    };

    AgentConnection.prototype._vaultReadChunk = function(blobId, seq){
        const _self = this;
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', vaultUrl(_self._api, 'read'));
            xhr.responseType = 'arraybuffer';
            xhr.setRequestHeader('X-Session-Id', _self.sessionId);
            xhr.setRequestHeader('X-Blob-Id', blobId);
            xhr.setRequestHeader('X-Chunk-Seq', String(seq));
            xhr.onload = function(){
                if(xhr.status === 200){
                    resolve(new Uint8Array(xhr.response));
                } else {
                    reject(new Error('Chunk ' + seq + ' could not be read'));
                }
            };
            xhr.onerror = function(){ reject(new Error('Chunk ' + seq + ': network error')); };
            xhr.send();
        });
    };

    /** Everything this channel holds. Sizes and hashes, never keys. */
    AgentConnection.prototype.vaultList = function(callback){
        this._vaultPost('list', {}, callback);
    };

    /** What this deployment allows and what the channel has used. */
    AgentConnection.prototype.vaultQuota = function(callback){
        this._vaultPost('quota', {}, callback);
    };

    AgentConnection.prototype.vaultDelete = function(blobId, callback){
        this._vaultPost('delete', {blobId : blobId}, callback);
    };

    AgentConnection.prototype.vaultStatus = function(blobId, callback){
        this._vaultPost('status', {blobId : blobId}, callback);
    };

    /** Shared JSON POST for the vault endpoints. @private */
    AgentConnection.prototype._vaultPost = function(endpoint, body, callback){
        const _self = this;

        if(!_self.readyState || !_self.sessionId){
            typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
            return;
        }

        const payload = Object.assign({sessionId : _self.sessionId}, body || {});

        const xhr = new XMLHttpRequest();
        xhr.open('POST', vaultUrl(_self._api, endpoint));
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onload = function(){
            if(xhr.status === 200 || xhr.status === 201){
                try {
                    typeof callback === 'function' && callback(JSON.parse(xhr.responseText));
                } catch(e) {
                    typeof callback === 'function' && callback({status : 'error', data : 'Invalid response'});
                }
            } else {
                let msg = xhr.responseText || xhr.statusText;
                try { msg = (JSON.parse(xhr.responseText).statusMessage) || msg; } catch(e) {}
                typeof callback === 'function' && callback({status : 'error', data : msg, statusMessage : msg});
            }
        };

        xhr.onerror = function(){
            typeof callback === 'function' && callback({status : 'error', data : 'Network error'});
        };

        xhr.send(JSON.stringify(payload));
    };

    // ---- Knock: reach a browser that is closed -----------------------------
    //
    // A knock is a CONTENT-FREE ping. No payload is sent -- not an encrypted
    // one, none at all -- so the push service learns that something happened
    // and never what, or from whom. When the person opens the page, the page
    // fetches the real thing over the authenticated channel.
    //
    // What an app may say: "a knock was sent". What no app may say: "they were
    // notified". Push is best effort -- permission gets declined, iOS delivers
    // only to an installed PWA, services throttle, a sleeping laptop gets it on
    // waking. Nothing in this file knows whether a human saw anything, so
    // nothing built on it may claim so.

    function knockUrl(apiBase, endpoint){
        let baseUrl = apiBase || '';
        if(baseUrl.endsWith('/')){
            baseUrl = baseUrl.substring(0, baseUrl.length - 1);
        }
        return `${baseUrl}/knock/${endpoint}`;
    }

    /** base64url (what a VAPID key is) to the Uint8Array PushManager wants. */
    function knockKeyToBytes(base64url){
        const padded = (base64url + '='.repeat((4 - base64url.length % 4) % 4))
            .replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(padded);
        const bytes = new Uint8Array(raw.length);
        for(let i = 0; i < raw.length; i++){
            bytes[i] = raw.charCodeAt(i);
        }
        return bytes;
    }

    function knockB64Url(arrayBuffer){
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for(let i = 0; i < bytes.length; i++){
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    /**
     * Ask this browser to accept knocks in the current channel.
     *
     * Four things have to go right, and each fails differently, so the result
     * says WHICH: no service worker or PushManager (unsupported), the person
     * said no (denied), the platform has no usable key (no_key), or the
     * subscription itself failed (subscribe_failed).
     *
     * Call it from a click. A permission prompt fired on page load is refused
     * outright by some browsers and resented by every user.
     *
     *     const res = await channel.knockSubscribe({swPath : '/knock-sw.js'});
     *     if(!res.ok) explain(res.reason);
     */
    AgentConnection.prototype.knockSubscribe = async function(options){
        const _self = this;
        const opts = options || {};
        const swPath = opts.swPath || '/knock-sw.js';

        if(!_self.readyState || !_self.sessionId){
            return {ok : false, reason : 'not_connected'};
        }
        if(typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)){
            return {ok : false, reason : 'unsupported'};
        }

        // The server's key first: if it is ephemeral, every subscription taken
        // with it dies at the next restart, and asking somebody for permission
        // that will be wasted is worse than not asking.
        const keyInfo = await new Promise(resolve => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', knockUrl(_self._api, 'key'));
            xhr.onload = function(){
                try { resolve(JSON.parse(xhr.responseText).data); } catch(e) { resolve(null); }
            };
            xhr.onerror = function(){ resolve(null); };
            xhr.send();
        });
        if(!keyInfo || !keyInfo.applicationServerKey){
            return {ok : false, reason : 'no_key'};
        }
        if(keyInfo.ephemeral && !opts.allowEphemeralKey){
            // Deliberately a refusal rather than a warning. Pass
            // allowEphemeralKey:true in a demo where the churn does not matter.
            return {ok : false, reason : 'ephemeral_key',
                    detail : 'The platform has no configured VAPID key, so this subscription '
                           + 'would stop working at its next restart.'};
        }

        try {
            const registration = await navigator.serviceWorker.register(swPath);
            await navigator.serviceWorker.ready;

            const permission = await window.Notification.requestPermission();
            if(permission !== 'granted'){
                return {ok : false, reason : 'denied'};
            }

            let subscription = await registration.pushManager.getSubscription();
            if(!subscription){
                subscription = await registration.pushManager.subscribe({
                    // Required to be true by every browser: a subscription that
                    // could ping silently is not allowed to exist.
                    userVisibleOnly : true,
                    applicationServerKey : knockKeyToBytes(keyInfo.applicationServerKey)
                });
            }

            const json = subscription.toJSON ? subscription.toJSON() : {};
            const keys = json.keys || {};
            const stored = await new Promise(resolve => {
                _self._knockPost('subscribe', {
                    endpoint : subscription.endpoint,
                    p256dh : keys.p256dh || knockB64Url(subscription.getKey('p256dh')),
                    auth : keys.auth || knockB64Url(subscription.getKey('auth'))
                }, resolve);
            });
            if(!stored || stored.status !== 'success'){
                return {ok : false, reason : 'subscribe_failed',
                        detail : (stored && (stored.statusMessage || stored.data)) || 'unknown'};
            }
            return {ok : true, endpoint : subscription.endpoint,
                    subscriptions : stored.data && stored.data.subscriptions};
        } catch(e) {
            return {ok : false, reason : 'subscribe_failed', detail : String(e && e.message || e)};
        }
    };

    /** Stop knocks to this browser in this channel. */
    AgentConnection.prototype.knockUnsubscribe = async function(){
        const _self = this;
        if(typeof navigator === 'undefined' || !('serviceWorker' in navigator)){
            return {ok : false, reason : 'unsupported'};
        }
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = registration && await registration.pushManager.getSubscription();
        if(!subscription){
            return {ok : true, reason : 'not_subscribed'};
        }
        await new Promise(resolve => _self._knockPost('unsubscribe', {endpoint : subscription.endpoint}, resolve));
        await subscription.unsubscribe();
        return {ok : true};
    };

    /**
     * Knock on one member of this channel.
     *
     * The callback receives per-device outcomes -- sent, rate_capped, failed,
     * dropped -- and a `meaning` string saying what "sent" is worth. Show the
     * user that sentence, not a checkmark.
     */
    AgentConnection.prototype.knock = function(agentName, options, callback){
        if(typeof options === 'function'){
            callback = options;
            options = {};
        }
        this._knockPost('send', {agent : agentName, tag : (options || {}).tag || null}, callback);
    };

    /** Who here can be knocked on: names and device counts, never endpoints. */
    AgentConnection.prototype.knockReachable = function(callback){
        this._knockPost('reachable', {}, callback);
    };

    /** Shared POST for the knock endpoints. @private */
    AgentConnection.prototype._knockPost = function(endpoint, body, callback){
        const _self = this;

        if(!_self.readyState || !_self.sessionId){
            typeof callback === 'function' && callback({status : 'error', data : 'The channel is not ready.'});
            return;
        }

        const payload = Object.assign({sessionId : _self.sessionId}, body || {});

        const xhr = new XMLHttpRequest();
        xhr.open('POST', knockUrl(_self._api, endpoint));
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onload = function(){
            if(xhr.status === 200 || xhr.status === 201){
                try {
                    typeof callback === 'function' && callback(JSON.parse(xhr.responseText));
                } catch(e) {
                    typeof callback === 'function' && callback({status : 'error', data : 'Invalid response'});
                }
            } else {
                let msg = xhr.responseText || xhr.statusText;
                try { msg = (JSON.parse(xhr.responseText).statusMessage) || msg; } catch(e) {}
                typeof callback === 'function' && callback({status : 'error', data : msg, statusMessage : msg});
            }
        };

        xhr.onerror = function(){
            typeof callback === 'function' && callback({status : 'error', data : 'Network error'});
        };

        xhr.send(JSON.stringify(payload));
    };

    // ---- Till: licences, seats and the honest gate -------------------------
    //
    // One licensing check instead of one per app. Till answers three questions
    // -- is this key good for this app, is a seat free, and until when -- and
    // nothing else. It never sees a card; a payment provider owns that.
    //
    // READ THIS BEFORE GATING ANYTHING ON IT. A check that runs in a browser
    // is a COURTESY. It shows an honest user the honest path and it makes the
    // paid door obvious. It stops nobody who opens devtools, and it is not
    // supposed to. The check that PROTECTS something is the one on whichever
    // server call the app already makes -- Till just makes the honest check
    // cheap enough that no app has an excuse to skip it.
    //
    //   const verdict = await AgentConnection.Till.check({
    //       api : '/messaging-platform/api/v1/messaging-service',
    //       app : 'signet',
    //       key : localStorage.getItem('signet.licence')
    //   });
    //   if(!verdict.valid) showBuyScreen(verdict.reason);

    function tillUrl(apiBase, endpoint){
        let baseUrl = apiBase || '';
        if(baseUrl.endsWith('/')){
            baseUrl = baseUrl.substring(0, baseUrl.length - 1);
        }
        return `${baseUrl}/till/${endpoint}`;
    }

    function tillPost(apiBase, endpoint, body){
        return new Promise(function(resolve){
            const xhr = new XMLHttpRequest();
            xhr.open('POST', tillUrl(apiBase, endpoint));
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = function(){
                let parsed = null;
                try { parsed = JSON.parse(xhr.responseText); } catch(e) {}
                if((xhr.status === 200 || xhr.status === 201) && parsed && parsed.data){
                    resolve(parsed.data);
                    return;
                }
                // A refusal and a network failure are BOTH "no entitlement".
                // Returning a verdict rather than throwing keeps every caller
                // on one path: an app that crashed on a flaky network would
                // lock out a paying customer over a dropped packet.
                const message = (parsed && parsed.statusMessage) || xhr.statusText || 'unavailable';
                resolve({valid : false, reason : 'unavailable', detail : message, seats : 0, seatsUsed : 0});
            };
            xhr.onerror = function(){
                resolve({valid : false, reason : 'unavailable', detail : 'Network error', seats : 0, seatsUsed : 0});
            };
            xhr.send(JSON.stringify(body || {}));
        });
    }

    const Till = {

        /** Set once at boot so every later call can omit `api`. */
        api : null,

        configure : function(api){
            Till.api = api;
            return Till;
        },

        _base : function(api){
            const base = api || Till.api;
            if(!base){
                throw new Error('Till needs an API base: Till.configure(api) or pass {api}.');
            }
            return base;
        },

        /**
         * Is this key good for this app right now?
         *
         * Resolves to { valid, plan, seats, seatsUsed, expiresAt, reason } and
         * never rejects. `reason` is one of: unknown_or_revoked, revoked,
         * past_due, expired, site_mismatch, no_seats_available, unavailable.
         *
         * An unknown key and a key for a DIFFERENT product both answer
         * "unknown_or_revoked" — the server will not tell a caller what else
         * the holder owns, and will not confirm a guess.
         */
        check : function({api = null, app, key, seatRef = null} = {}){
            return tillPost(Till._base(api), 'entitlement', {app : app, key : key, seatRef : seatRef});
        },

        /**
         * Take or refresh a seat.
         *
         * `seatRef` is whatever this app calls a user; it is hashed before the
         * server stores it, so Till counts seats without keeping a list of who
         * they are. Refreshing a seat you already hold always succeeds, even on
         * a full licence — otherwise closing a laptop could lock you out until
         * a colleague left.
         */
        claimSeat : function({api = null, app, key, seatRef} = {}){
            return tillPost(Till._base(api), 'seat/claim', {app : app, key : key, seatRef : seatRef});
        },

        releaseSeat : function({api = null, app, key, seatRef} = {}){
            return tillPost(Till._base(api), 'seat/release', {app : app, key : key, seatRef : seatRef});
        },

        /**
         * check() (or claimSeat() when a seatRef is given), rejecting when the
         * answer is no — for `await`-shaped app shells.
         *
         * The rejection carries the verdict, so a caller can say WHY the door
         * is shut ("your licence expired") instead of a blank refusal.
         */
        require : async function(options = {}){
            const verdict = options.seatRef
                ? await Till.claimSeat(options)
                : await Till.check(options);
            if(!verdict || !verdict.valid){
                const error = new Error('Not licensed for ' + options.app + ': '
                    + ((verdict && verdict.reason) || 'unknown'));
                error.verdict = verdict;
                throw error;
            }
            return verdict;
        },

        /**
         * Keep the holder's own copy of their key in this browser.
         *
         * Convenience, not custody: it is the customer's key, on the
         * customer's machine, and localStorage is exactly as private as the
         * machine is. Nothing here is a secret from the person sitting there.
         */
        remember : function(app, key){
            try { window.localStorage.setItem('till.licence.' + app, key); } catch(e) {}
        },

        recall : function(app){
            try { return window.localStorage.getItem('till.licence.' + app); } catch(e) { return null; }
        },

        forget : function(app){
            try { window.localStorage.removeItem('till.licence.' + app); } catch(e) {}
        }
    };

    AgentConnection.Till = Till;

    // Export for Node.js
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            AgentConnection,
            Till,
            MySecurity,
            FileSystem,
            generateRandomAgentName
        };
    }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {}));
