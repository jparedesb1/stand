/**
 * Fetcher for financial data - Uses services.4yousee.com.br
 */
(function(global) {
	// defaults
	var baseURL = 'http://services.4yousee.com.br/finance/currency';
	var baseSymbol = 'BRL';
	var symbol = 'USD';
	var type = 'currency';
	var localStorageKey = '4yousee-designer-finance|';

	function requestData(config, cb) {
		var endpoint = config.baseURL + "?base=" + config.baseSymbol + "&symbols=" + config.symbol;
		var xhr = new XMLHttpRequest();

		xhr.onload = function() {
			if (this.status >= 200 && this.status < 400) {
				// Success!
				try {
					global.localStorage.setItem(localStorageKey + config.baseSymbol + '|' + config.symbol, this.response);
				} catch (e) {
					console.error('Error while writing to localStorage', e);
				}
				var data = JSON.parse(this.response);
				cb(null, data);
			} else {
				cb(this.status);
			}
		};

		xhr.onerror = function() {
			cb('Error while loading data: ' + this.status);
		};

		xhr.ontimeout = function() {
			cb('Timeout!');
		};

		xhr.open('GET', endpoint, true);
		xhr.send();
	}

	global.fetchFinancialData = function(config, callback) {
		config.baseURL = config.baseURL || baseURL;
		config.baseSymbol = config.baseSymbol || baseSymbol;
		config.symbol = config.symbol || symbol;
		config.type = config.type || type;

		var cachedData;
		try {
			cachedData = global.localStorage.getItem(localStorageKey + config.baseSymbol + '|' + config.symbol);
		} catch (e) {
			console.error('Error loading localStorage data');
		}
		if (cachedData) {
			requestData(config, function(){});
			return callback(null, JSON.parse(cachedData));
		}
		requestData(config, callback);
	};
})(window);
