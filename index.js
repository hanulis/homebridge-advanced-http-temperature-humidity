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
    this.humidity = 0;

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
    this.pollInterval = config.pollInterval || 60

    this.redisServer = config.redisServer || '';
    this.redisPort = config.redisPort || 6379;
    this.redisAuth = config.redisAuth || '';
    this.redisKey = config.redisKey || '';

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
                callback(error);
            } else {
                try {
                    this.log('Get Temperature succeeded!');
                    var info = JSON.parse(responseBody);

                    var temperature = parseFloat(info.temperature);

                    let logText="Temperature : "+temperature;

                    if (this.humidityService !== false) {
                        var humidity = parseFloat(info.humidity)

                        // this.humidityService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, humidity);
                        this.humidity = humidity;

                        logText+=", Humidity : "+humidity;
                    }

                    // this.log(logText);

                    callback(null, temperature);

                    this.temperatureService.updateCharacteristic(Characteristic.CurrentTemperature, temperature);
                    this.humidityService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, this.humidity);


                } catch(e) {}
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
                callback(error);
            } else {
                // this.log('UPDATE - Get Temperature succeeded!');
                if(responseBody) {
                    try {
                        var info = JSON.parse(responseBody);

                        if(info && info.temperature) {
                            var temperature = parseFloat(info.temperature);

                            let logText="UPDATE Temperature : "+temperature;
                            if (this.humidityService !== false) {
                                var humidity = parseFloat(info.humidity)

                                this.humidity = humidity;

                                logText+=", Humidity : "+humidity;
                            }

                            // this.log(logText);

                            if(this.redisKey) {
                                this.saveRedis(temperature, this.humidity);
                            }

                            callback();

                            this.temperatureService.updateCharacteristic(Characteristic.CurrentTemperature, temperature);
                            this.humidityService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, this.humidity);

                        }
                    } catch(e) {}
                }
            }
        }.bind(this));
    },

    saveRedis: async function(temperature, humidity) {

        try {
            const client = createClient(this.redisServer, this.redisPort);

            await client.connect();

            if(this.redisAuth) {
                client.auth(this.redisAuth);
            }

            // create key

            const created = await client.ts.create('temperature', {
                RETENTION: 86400000, // 1 day in milliseconds
                ENCODING: TimeSeriesEncoding.UNCOMPRESSED, // No compression - When not specified, the option is set to COMPRESSED
                DUPLICATE_POLICY: TimeSeriesDuplicatePolicies.BLOCK, // No duplicates - When not specified: set to the global DUPLICATE_POLICY configuration of the database (which by default, is BLOCK).
            });        

            const currentTimestamp = Date.now();

            await client.ts.add(this.redisKey+'_temperature', currentTimestamp, temperature);

            if(humidity) {
                await client.ts.add(this.redisKey+'_humidity', currentTimestamp, humidity);
            }

            await client.quit();
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

        setInterval(function () {
            this._update(function () {})
        }.bind(this), this.pollInterval * 1000)        

        return services;
    }
};