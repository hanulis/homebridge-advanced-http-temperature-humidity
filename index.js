var Service, Characteristic;
var request = require('request');
var { createClient } = require("redis");
var { TimeSeriesDuplicatePolicies, TimeSeriesEncoding, TimeSeriesAggregationType } = require('@redis/time-series');


module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-advanced-http-temperature-humidity", "AdvancedHttpTemperatureHumidity", AdvancedHttpTemperatureHumidity);
}

function AdvancedHttpTemperatureHumidity(log, config) {
    this.log = log;
    this.humidityService = false;
    this.temperatureService = false;

    // Set default values
    this.temperature = 23;
    this.humidity = 50;

    // Config
    this.url = config["url"];
    this.http_method = config["http_method"] || "GET";
    this.sendimmediately = config["sendimmediately"] || false;
    this.username = config["username"] || "";
    this.password = config["password"] || "";

    this.name = config["name"];

    this.manufacturer = config["manufacturer"] || "HttpTemperatureHumidity";
    this.model = config["model"] || "Default";
    this.serial = config["serial"] || "18981898";

    this.disableHumidity = config["disableHumidity"] || false;

    // add opt
    this.pollInterval = config["pollInterval"] || 60

    this.redisServer = config["redisServer"] || '';
    this.redisPort = config["redisPort"] || 6379;
    this.redisAuth = config["redisAuth"] || '';
    this.redisKey = config["redisKey"] || '';

    this.timeoutId = 0;

}

AdvancedHttpTemperatureHumidity.prototype = {

    httpRequest: function (url, body, method, username, password, sendimmediately, callback) {
        request({
                url: url,
                body: body,
                method: method,
                rejectUnauthorized: false,
                auth: {
                    user: username,
                    pass: password,
                    sendImmediately: sendimmediately
                }
            },
            function (error, response, body) {
                callback(error, response, body)
            })
    },

    getStateHumidity: function (callback) {
        callback(null, this.humidity);
    },

    getState: function (callback) {
        this.httpRequest(this.url, "", this.http_method, this.username, this.password, this.sendimmediately, function (error, response, responseBody) {

            if (error) {
                this.log('Get Temperature failed: %s', error.message);
                callback(null, this.temperature);
            } else {
                try {
                    // this.log('Get Temperature succeeded!');
                    var info = JSON.parse(responseBody);

                    this.temperature = parseFloat(info.temperature);

                    let logText="Temperature : "+this.temperature;

                    if (this.humidityService !== false) {
                        this.humidity = parseFloat(info.humidity)

                        // this.humidityService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, humidity);
                        // this.humidity = humidity;
                        logText+=", Humidity : "+this.humidity;
                    }

                    if(this.redisKey) {
                        this.saveRedis(this.temperature, this.humidity);
                    }

                    this.log("Get Temperature : %s", logText);

                    if(callback) {
                        // this.log("call callback");
                        callback(null, this.temperature);
                    } else {
                        // this.log("no callback");
                    }

                    this.temperatureService.setCharacteristic(Characteristic.CurrentTemperature, this.temperature);
                    this.humidityService.setCharacteristic(Characteristic.CurrentRelativeHumidity, this.humidity);

                    if(this.pollInterval) {
                        // this.log("poll interval : %s", this.pollInterval);

                        if(this.timeoutId) {
                            clearTimeout(this.timeoutId);
                        }
    
                        // let instance=this;
                        this.timeoutId=setTimeout(()=>{
                            // this._update(()=>{})
                            // console.log("call poll");
                            this.getState();
                        }, this.pollInterval * 1000);                    
    
                    } else {
                        // this.log("no poll interval");
                    }

        
                } catch(e) {
                    this.log(e);
                }
            }
        }.bind(this));
    },

    identify: function (callback) {
        this.log("Identify requested!");
        callback(); // success
    },

    _update: function(callback) {
        this.httpRequest(this.url, "", this.http_method, this.username, this.password, this.sendimmediately, function (error, response, responseBody) {

            if (error) {
                this.log('UPDATE - Get Temperature failed: %s', error.message);
                callback();
            } else {
                // this.log('UPDATE - Get Temperature succeeded!');
                if(responseBody) {
                    try {
                        var info = JSON.parse(responseBody);

                        if(info && info.temperature) {
                            this.temperature = parseFloat(info.temperature);

                            let logText="UPDATE Temperature : "+this.temperature;
                            if (this.humidityService !== false) {
                                this.humidity = parseFloat(info.humidity);

                                logText+=", Humidity : "+humidity;
                            }

                            this.log(logText);

                            if(this.redisKey) {
                                this.saveRedis(this.temperature, this.humidity);
                            }

                            callback();

                            this.temperatureService.setCharacteristic(Characteristic.CurrentTemperature, this.temperature);
                            this.humidityService.setCharacteristic(Characteristic.CurrentRelativeHumidity, this.humidity);

                        }
                    } catch(e) {}
                }
            }
        }.bind(this));
    },

    saveRedis: async function(temperature, humidity) {

        try {
            // const client = createClient(this.redisServer, this.redisPort);
            const client = createClient(
                {
                    socket: {
                        host: this.redisServer,
                        port: this.redisPort
                    },
                    password: this.redisAuth
                }              
            );

            await client.connect();

            // if(this.redisAuth) {
            //     client.auth(this.redisAuth);
            // }      

            const currentTimestamp = Date.now();

            await client.ts.add(this.redisKey+'_temperature', currentTimestamp, temperature);

            if(humidity) {
                await client.ts.add(this.redisKey+'_humidity', currentTimestamp, humidity);
            }

            await client.quit();
        } catch(e) {
            console.error(e);
        }

    },

    createRedisKey: async function() {


        try {
            // const client = createClient(this.redisServer, this.redisPort);
            const client = createClient(
                {
                    socket: {
                        host: this.redisServer,
                        port: this.redisPort
                    },
                    password: this.redisAuth
                }              
            );

            await client.connect();        
            // create key

            const created_temp = await client.ts.create(this.redisKey+'_temperature', {
                RETENTION: 86400000, // 1 day in milliseconds
                ENCODING: TimeSeriesEncoding.UNCOMPRESSED, // No compression - When not specified, the option is set to COMPRESSED
                DUPLICATE_POLICY: TimeSeriesDuplicatePolicies.BLOCK, // No duplicates - When not specified: set to the global DUPLICATE_POLICY configuration of the database (which by default, is BLOCK).
            });        
            const created_humi = await client.ts.create(this.redisKey+'_humidity', {
                RETENTION: 86400000, // 1 day in milliseconds
                ENCODING: TimeSeriesEncoding.UNCOMPRESSED, // No compression - When not specified, the option is set to COMPRESSED
                DUPLICATE_POLICY: TimeSeriesDuplicatePolicies.BLOCK, // No duplicates - When not specified: set to the global DUPLICATE_POLICY configuration of the database (which by default, is BLOCK).
            }); 
        } catch(e) {
            
        }         
    },
    getServices: function () {
        var services = [],
            informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
            .setCharacteristic(Characteristic.Model, this.model)
            .setCharacteristic(Characteristic.SerialNumber, this.serial);
        services.push(informationService);

        this.temperatureService = new Service.TemperatureSensor(this.name);
        this.temperatureService
            .getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getState.bind(this));
        services.push(this.temperatureService);

        if (this.disableHumidity !== true) {
            this.humidityService = new Service.HumiditySensor(this.name);
            this.humidityService
                .getCharacteristic(Characteristic.CurrentRelativeHumidity)
                .setProps({minValue: 0, maxValue: 100})
                .on('get', this.getStateHumidity.bind(this));
            services.push(this.humidityService);
        }
        
        if(this.redisKey) {
            this.createRedisKey();
        }

        return services;
    }
};