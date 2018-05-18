/**
 * Yahoo Forecast Wrapper - Adapted for 4YouSee Designer
 */
(function(global) {
	var baseURL = 'http://query.yahooapis.com/v1/public/yql?format=json',
		conditionCodeMap = {
			0 : 0xf056, //tornado
			1 : 0xf00e, //tropical storm
			2 : 0xf073, //hurricane
			3 : 0xf01e, //severe thunderstorms
			4 : 0xf01e, //thunderstorms
			5 : 0xf017, //mixed rain and snow
			6 : 0xf017, //mixed rain and sleet
			7 : 0xf017, //mixed snow and sleet
			8 : 0xf015, //freezing drizzle
			9 : 0xf01a, //drizzle
			10 : 0xf015, //freezing rain
			11 : 0xf01a, //showers
			12 : 0xf01a, //showers
			13 : 0xf01b, //snow flurries
			14 : 0xf00a, //light snow showers
			15 : 0xf064, //blowing snow
			16 : 0xf01b, //snow
			17 : 0xf015, //hail
			18 : 0xf017, //sleet
			19 : 0xf063, //dust
			20 : 0xf014, //foggy
			21 : 0xf021, //haze
			22 : 0xf062, //smoky
			23 : 0xf050, //blustery
			24 : 0xf050, //windy
			25 : 0xf076, //cold
			26 : 0xf013, //cloudy
			27 : 0xf031, //mostly cloudy (night)
			28 : 0xf002, //mostly cloudy (day)
			29 : 0xf031, //partly cloudy (night)
			30 : 0xf002, //partly cloudy (day)
			31 : 0xf02e, //clear (night)
			32 : 0xf00d, //sunny
			33 : 0xf083, //fair (night)
			34 : 0xf00c, //fair (day)
			35 : 0xf017, //mixed rain and hail
			36 : 0xf072, //hot
			37 : 0xf00e, //isolated thunderstorms
			38 : 0xf00e, //scattered thunderstorms
			39 : 0xf00e, //scattered thunderstorms
			40 : 0xf01a, //scattered showers
			41 : 0xf064, //heavy snow
			42 : 0xf01b, //scattered snow showers
			43 : 0xf064, //heavy snow
			44 : 0xf00c, //partly cloudy
			45 : 0xf00e, //thundershowers
			46 : 0xf01b, //snow showers
			47 : 0xf00e, //isolated thundershowers
			3200 : 0xf077//not available
		};

	/**
	 * Make the JSONP request to Yahoo API
	 * @param  {String}   url  Full URL to be called
	 * @param  {Function} done Callback
	 * @source http://stackoverflow.com/a/22780569/1620498
	 */
	function requestJSONP(url, done) {
		var callbackName = 'jsonp_callback_' + Math.round(100000 * Math.random());
		global[callbackName] = function(data) {
			delete global[callbackName];
			document.body.removeChild(script);
			done(data);
		};

		var script = document.createElement('script');
		script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + callbackName;
		document.body.appendChild(script);
	}

	/**
	 * Receive parameters to fetch weather data and returns it
	 * @param  {Number}   woeid    WhereOnEarthID
	 * @param  {String}   unit     'c' for Celsius or 'f' for Fahrenheit
	 * @param  {Function} callback Function that will receive the data
	 */
	function getForecastForWOEID(config, callback) {
		var yqlQuery = 'select item from weather.forecast where woeid=' + config.woeid + ' and u="' + config.unit + '"',
			encodedQuery = encodeURIComponent(yqlQuery),
			url = baseURL + '&q=' + encodedQuery,
			timeout, returned;

		// Timeout handling
		timeout = setTimeout(function() {
			if (!returned) {
				returned = true;
				callback();
			}
		}, 2000); // 2s timeout

		requestJSONP(url, function(data) {
			if (!returned) {
				clearTimeout(timeout);
				returned = true;
				callback(data);
			}
		});
	}

	/**
	 * Fetch the forecasts for the parameters passed as configs
	 * @param  {Object}   config   Config object with the following parameters:
	 *                               · woeid {Number}: WhereOnEarthID
	 *                               · [optional] unit {String}: 'c' for Celsius or 'f' for Fahrenheit (default)
	 * @param  {Function} callback [description]
	 * @return {[type]}            [description]
	 */
	global.yahooForecast = function getForecast(config, callback) {
		if (typeof callback !== 'function') {
			throw new Error('No callback provided!');
		}

		if (!config || !config.woeid) {
			callback('Please set config with mandatory woeid');
			return;
		}
		config.unit = config.unit || 'f';

		getForecastForWOEID(config, function mapConditionCodes(data) {
			var formattedData = {};
			if (data &&
				data.query &&
				data.query.results &&
				data.query.results.channel &&
				data.query.results.channel.item
			) {
				var item = data.query.results.channel.item;
				if (item.forecast.length > 0) {
					formattedData.mainForecast = {
						icon : conditionCodeMap[item.forecast[0].code],
						max : item.forecast[0].high,
						min : item.forecast[0].low
					};
					formattedData.extraForecasts = [];
					item.forecast.forEach(function(f) {
						formattedData.extraForecasts.push({
							icon : conditionCodeMap[f.code],
							max : f.high,
							min : f.low
						});
					});
				}
				callback(null, formattedData);
			} else {
				callback('timeout');
			}
		});
	};
})(window);
