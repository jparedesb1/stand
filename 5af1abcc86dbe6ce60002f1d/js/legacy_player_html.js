(function(global) {
	var DS_queryString = '',
		DS_object      = '',
		sceneIndex     = 0,
		nextSceneID	   = null,
		course         = global.getProjectJSON(),
		images         = {},
		player         = {
			/* global numLoops:false*/
			totalLoops : numLoops,
			loop : 0,
			scenes : []
		},
		baseWidth     = course.orientation == 'portrait'?600:848,
		baseHeight    = course.orientation == 'portrait'?1068:480,
		currentWidth  = baseWidth,
		currentHeight = baseHeight,
		globalScale   = {
			x : 1,
			y : 1
		},
		canvas_container = document.getElementById('canvas_container'),
		isLoadingAScene  = false,
		preloadLock      = false,
		renderer         = new Render(),
		animation        = new Animation(),
		interaction      = new Interaction(),
		xmlns            = "http://www.w3.org/2000/svg",
		timeout,
		objectMap        = {},
		animationQueue   = [],
		YTPlayer, // YouTube player
		YTStatus    = global.YouTubeAPIReady, // YouTube Connectivity status: 0: offline, 1: online
		setYTOnline = function() {
			YTStatus = 1; // YouTube Online
		},
		videoElement    = document.createElement('video'),
		sourceElement   = document.createElement('source'),
		zIndex          = 0,
		videoPlaying    = false, // Controls scene change. If set to true, the player will wait before changing the scene
		oneSecondIntervals = [],
		dynamicData        = {},
		firstLoad          = true,
		triggerVideoPlay;

	/********************
	*	PLAYER EVENTS	*
	********************/
	var resizeCanvas = function() {
		var newWidth = global.innerWidth,
			newHeight = global.innerHeight,
			scaleX, scaleY, canvasWidth, canvasHeight;


		switch (course.orientation) {
			case 'portrait':
				scaleX = newWidth / 600;
				scaleY = newHeight / 1068;
				break;
			case 'custom':
				var scale;
				if (course.w > course.h) {
					// Landscape-like
					scale = 854/course.w;
					canvasWidth = 854;
					canvasHeight = Math.round(course.h*scale);
				} else {
					// Portrait-like
					scale = 480/course.h;
					canvasHeight = 480;
					canvasWidth = Math.round(course.w*scale);
				}
				scaleX = newWidth / canvasWidth;
				scaleY = newHeight / canvasHeight;
				break;
			default:
				scaleX = newWidth / 854;
				scaleY = newHeight / 480;
		}

		currentWidth = newWidth;
		currentHeight = newHeight;

		// Escala todo o conteúdo
		globalScale = {
			x : scaleX,
			y : scaleY
		};
	};
	global.addEventListener('resize', resizeCanvas);

	global.addEventListener('load', function() {
		DS_object = parseQueryString(global.location.search);

		if (typeof global.fetchData == 'function') {
			global.fetchData(function(err, data) {
				if (err || !data) {
					// On err, abort the template if possible
					if (global.Android && typeof global.Android.finish === 'function') {
						return global.Android.finish();
					}
				} else {
					// mescla as variáveis no DS_object
					DS_object = _.extend(DS_object, data);
				}
				init();
			});
		} else {
			// Atrasando init para pegar a largura certa da webview
			setTimeout(function() {
				init();
			}, 0);
		}
	});

	global.onYouTubeIframeAPIReady = setYTOnline;

	/********************
	*	PLAYER INIT		*
	********************/
	function init() {
		resizeCanvas();

		videoElement.appendChild(sourceElement);
		videoElement.style.position = 'fixed';
		videoElement.style.top = 0;
		videoElement.style.left = 0;
		if (isWebOS) {
			videoElement.setAttribute('width', global.innerWidth);
			videoElement.setAttribute('height', global.innerHeight);
		}
		videoElement.style.visibility = 'hidden';
		document.getElementById('video_container').appendChild(videoElement);

		sceneIndex = 0;
		player.loop = 1;

		looper();
		/* global execTime:false */
		if (player.totalLoops < 0 && execTime) {
			setTimeout(done, execTime*1000);
		}
	}


	function fetchAssets (scene, includeVideo) {
		var sceneAssets = [],
			objects = (scene.itens && scene.itens.objects)? _.compact(scene.itens.objects) : [];
		//For each scene
		var numObjects = objects.length;
		for (var j = 0; j < numObjects; j++) {
			// For each object in the scene with external src, put it to cache
			var object = objects[j];
			switch (object.type) {
				case 'video':
					if (object.videoProps.location !== 'youtube') {
						if (includeVideo) {
							sceneAssets[object.videoProps.url] = 1;
						}
					}
					break;
				case 'weather':
					sceneAssets['img/yahoo_purple.png'] = 1;
					sceneAssets['img/yahoo_white.png'] = 1;
					sceneAssets[object.id] = {
						woeid : object.woeid,
						unit : object.unit,
						extraForecasts : object.forecasts
					};
					break;
				case 'finance':
					// Currency Exchange info
					sceneAssets[object.id] = {
						baseSymbol : object.targetSymbol.letter,
						symbol : object.sourceSymbol.letter,
					};
					break;
				default:
					for (var attr in object) {
						if (attr == 'src' || attr == 'sourcePath' || attr == 'paths' || attr == 'boxPath') {
							if (object[attr]) {
								sceneAssets[object[attr]] = 1;
							}
						}
						// Img templateVar
						if (object.type == 'image' && attr == 'templateVar') {
							if (object[attr] && DS_object[object[attr]]) {
								var img_url = DS_object[object[attr]];
								sceneAssets[img_url] = 'template';
							}
						}
					}
			}
		}
		return sceneAssets;
	}

	function preloadAssets (scene, includeVideo, callback) {
		var preload = [],
			sceneAssets = fetchAssets(scene, includeVideo),
			canvas = document.createElement('canvas'),
			ctx = canvas.getContext('2d');

		for (var path in sceneAssets) {
			if (path.match(/mp4$/) && includeVideo) {
				preload.push(loadVideoFactory(path));
			} else if (/^\d+$/.test(path)) {
				// Async widget
				if (sceneAssets[path].woeid) {
					preload.push(loadWeatherFactory(path));
				} else {
					preload.push(loadCurrencyExchangeFactory(path))
				}
			} else if (typeof sceneAssets[path] !== 'function' && typeof images[path] == 'undefined') {
				var crossOrigin = (sceneAssets[path] === 'template');
				preload.push(loadImageFactory(path, crossOrigin));
			}
		}

		async.parallel(preload, function () {
			callback();
		});

		function loadImageFactory (name, crossOrigin) {
			return function loadImage(cb) {
				var imgURL = name;
				if (name.match(/^img\//)) {
					/* global dirPrefix:false */
					imgURL = dirPrefix + name;
				}
				var img = new Image();
				img.onload = function () {
					images[name] = imgURL;
					cb();
				};
				img.onerror = function () {
					cb();
				};
				img.src = imgURL;
			};
		}

		function loadVideoFactory(name) {
			return function loadVideo(cb) {
				var videoURL = name;

				if (name.match(/^video\//)) {
					/* global dirPrefix:false */
					videoURL = dirPrefix + name;
				}
				sourceElement.setAttribute('src', videoURL);
				sourceElement.setAttribute('type', 'video/mp4');
				videoElement.addEventListener('loadeddata', function videoLoaded (e) {
					videoElement.removeEventListener('loadeddata', videoLoaded);
					cb();
				});
				videoElement.load();
			};
		}

		function loadWeatherFactory(objectID) {
			return function loadWeatherForecast(cb) {
				var cacheStorage = global.localStorage.getItem('4yousee-designer-weather-' + objectID);
				if (cacheStorage) {
					dynamicData[objectID] = JSON.parse(cacheStorage);
					cb();
				}
				global.yahooForecast(sceneAssets[objectID], function(err, data) {
					if (!err) {
						dynamicData[objectID] = data;
						global.localStorage.setItem('4yousee-designer-weather-' + objectID, JSON.stringify(data));
					}
					if (!cacheStorage) {
						cb();
					}
				});
			};
		}

		function loadCurrencyExchangeFactory(objectID) {
			return function loadFinanceData(cb) {
				window.fetchFinancialData(sceneAssets[objectID], function(err, data) {
					if (!err) {
						dynamicData[objectID] = data;
					}
					cb();
				});
			};
		}
	}
	/********************
	*	MAIN LOOP		*
	********************/
	function looper () {
		if (videoPlaying) {
			// Video is still playing. Wait 150ms and try again
			timeout = setTimeout(looper, 150);
			return;
		}

		// Clear update intervals for date/time widget
		oneSecondIntervals.forEach(function(interval) {
			clearInterval(interval);
		});
		oneSecondIntervals = [];

		// Hides video
		videoElement.style.visibility = 'hidden';

		var totalScenes = course.scenes.length, scene;

		if (nextSceneID) {
			var scenesById = _.map(course.scenes, function (scene) {
				return scene.id;
			});
			var index = _.indexOf(scenesById, nextSceneID);
			if (index >= 0) {
				clearTimeout(timeout);
				scene = course.scenes[index];
				preloadAssets(scene, true, function() {
					renderScene(scene);
					sceneIndex = index+1;
				});
			}
		} else {
			if (sceneIndex == totalScenes){
				sceneIndex = 0;
				player.loop++;
				if(player.totalLoops >= 0 && player.loop > player.totalLoops){
					done();
					return;
				}
			}

			if (sceneIndex < totalScenes){
				scene = course.scenes[sceneIndex];
				preloadAssets(scene, true, function() {
					renderScene(scene);
				});
			}
			sceneIndex++;
		}
	}

	function renderScene(scene) {
		// Clean-up
		removeVideo(function() {
			document.getElementById('log').innerHTML = "";
			zIndex = 0;

			// Clear Canvas
			var objects = scene.itens.objects;
			objectMap = {};
			animationQueue = [];
			if (objects[0].type !== 'video') {
				renderer.background(objects[0], loadSceneObjects);
			} else {
				loadSceneObjects(null, true);
			}

			// Get the ID for the next scene, if it is set
			if (scene.next_scene) {
				nextSceneID = scene.next_scene;
			} else {
				nextSceneID = null;
			}

			function loadSceneObjects (currentBgImg, loadVideoAsBackground) {
				while (canvas_container.lastChild) {
					if (canvas_container.lastChild.onEntryEnd) {
						canvas_container.lastChild.onEntryEnd = undefined;
						canvas_container.lastChild.onExitEnd = undefined;
					}
					canvas_container.removeChild(canvas_container.lastChild);
				}
				var object = objects[0];
				if (loadVideoAsBackground) {
					renderer.video(object, true);
				}
				for (var i = 1; i < objects.length; i++) {
					object = objects[i];
					var type = object.type;
					if (renderer[type]) {
						renderer[type](object);
					} else {
						// console.error("Unrecognizable type: " + object.type);
						// console.dir(object);
					}
				}

				if (firstLoad) {
					// If this is the content boot, check for the Android.ready() function
					if (window.Android && typeof window.Android.ready === 'function') {
						window.Android.ready(runContent);
					} else {
						runContent();
					}
				} else {
					runContent();
				}

				function runContent() {
					if (scene.transition !== 'manual') {
						timeout = setTimeout(looper, scene.duration*1000);
					}
					// After all objects are loaded, run animations
					animationQueue.forEach(function(a) {
						a.fn.apply(null, a.arguments);
					});
					if (firstLoad && triggerVideoPlay) {
						triggerVideoPlay();
					}
					firstLoad = false;
					isLoadingAScene = false;
					clearOldBackground();
					oldBGImage = currentBgImg;
					preloadNextScenes();
				}
			}
		});
	}

	/************************
	*	END OF PRESENTATION	*
	************************/
	function done () {
		// Clear timeout
		clearTimeout(timeout);
		/**
		 * So far is not possible to insert an alternate to Android.finish(), so I will mute this for now
		 */

		/* global endFunctionString:false */
		/*var endFunctionParameters = endFunctionString.match(/((\S+)\.)*(\S+)\((.*)\);?$/);

		if (endFunctionParameters) {
			var namespaces = endFunctionParameters[2]?endFunctionParameters[2].split('.'):[],
				fnName = endFunctionParameters[3],
				fnArgs = endFunctionParameters[4]?endFunctionParameters[4].split(','):null;

			// Get Function context
			var context = window;
			for (var i = 0; i < namespaces.length; i++) {
				context = context[namespaces[i]];
			}
			if (typeof context[fnName] === 'function') {
				context[fnName].apply(context, fnArgs);
			} else {
				// console.error("endFunc is not a function");
			}
			// setTimeout(endFunctionString, 100);
		} else {
			// Default if not set/valid is to call Android.finish
			if (window.Android && typeof window.Android.finish == 'function') {
				window.Android.finish();
			}
		}*/

		if (window.AreaInterface && typeof window.AreaInterface.nextNews == 'function') {
			// This is a layout content, not a main area one
			var response = window.AreaInterface.nextNews();
			if (response) {
				// Android with news
				if( (typeof(response) == 'string') && (response.indexOf('&') !== -1 )) {
					var rss = response.split('&');
					window.loadNews(rss[0], rss[1]);
				} else {
					window.loadNews(null, null);
				}
			} else {
				if (window.Android && typeof window.Android.finish == 'function') {
					// Chrome-like
					window.Android.finish();
				} else {
					// Android with no news
					window.loadNews(null, null);
				}
			}
		} else {
			if (window.Android && typeof window.Android.finish == 'function') {
				window.Android.finish();
			}
		}
	}

	//////////////////////////
	// Layout news template //
	//////////////////////////
	window.loadNews = function (imgVar, txtVar) {
		DS_object = {
			imgVar : imgVar,
			txtVar : txtVar
		};
		parseTxtVar(txtVar, DS_object);
		looper();
	};

	/************************
	*	Scene Preloading	*
	************************/
	function preloadNextScenes () {
		var sceneCount = sceneIndex;
		if (sceneCount >= course.scenes.length) {
			return;
		}
		if (preloadLock) {
			return;
		}
		preloadLock = true;
		async.doWhilst(function preload (callback) {
			var scene = course.scenes[sceneCount++];
			preloadAssets(scene, false, callback);
		}, function test () {
			return !isLoadingAScene && sceneCount<course.scenes.length;
		}, function done (err) {
			preloadLock = false;
			if (sceneCount>=course.scenes.length) {
			} else {
			}
		});
	}

	/**
	 * Classe que agrupa as funções de renderização e seus métodos particulares auxiliares
	 */
	function Render() {
		// Renderiza o fundo
		this.background = function renderBG(object, callback) {
			var background = document.getElementById('background'),
				savedOpacity = (typeof object.savedOpacity == 'number'?object.savedOpacity:1);
			background.style.background = 'black';
			if (object.type == 'rect' || object.src.match('blank.gif')) {
				while (background.lastChild) {
					background.removeChild(background.lastChild);
				}
				background.style.background = 'white';
				oldBGImage = null;
				callback();
			} else {
				var bgImage;
				if (firstLoad) {
					bgImage = background.firstElementChild;
					bgImage.className = '';
				} else {
					bgImage = new Image();
					bgImage.src = images[object.src];
					background.appendChild(bgImage);
					bgImage.style.position = 'absolute';
					bgImage.style.top = 0;
					bgImage.style.left = 0;
					// Renderiza a imagem, mas a deixa invisível
					bgImage.style.opacity = 0;
				}
				if (object.angle) {
					bgImage.width =  currentHeight;
					bgImage.setAttribute('width', currentHeight);
					bgImage.height = currentWidth;
					bgImage.setAttribute('height', currentWidth);
					bgImage.style.webkitTransformOrigin = 'top left';
					bgImage.style.transformOrigin = 'top left';
					bgImage.style.webkitTransform = 'rotate(' + object.angle + 'deg)';
					bgImage.style.transform = 'rotate(' + object.angle + 'deg)';
					var bgTransform;
					if (object.flipX) {
						_flip(bgImage, object);
						bgTransform = bgImage.style.transform || bgImage.style.webkitTransform || '';
						bgImage.style.webkitTransform = bgTransform + ' translate(-'+ currentHeight + 'px, -' + currentWidth + 'px)';
						bgImage.style.transform = bgTransform + ' translate(-'+ currentHeight + 'px, -' + currentWidth + 'px)';
					} else {
						bgTransform = bgImage.style.transform || bgImage.style.webkitTransform || '';
						bgImage.style.webkitTransform = bgTransform + ' translateY(-'+ currentWidth + 'px)';
						bgImage.style.transform = bgTransform + ' translateY(-'+ currentWidth + 'px)';
					}
				} else {
					bgImage.width = currentWidth;
					bgImage.height =  currentHeight;
					_flip(bgImage, object);
				}
				// Depois remove a imagem anterior e mostra o novo background
				setTimeout(function() {
					bgImage.style.opacity = savedOpacity;
					callback(bgImage);
				}, 50);
			}
		};
		/**
		 * Renderiza as imagens do fabric
		 */
		this.image = function renderImage(object) {
			var dim = calculateGenericDimensions(object), image = new Image(),
				box = document.createElement('div');

			box.setAttribute("id", object.id);
			box.style.position = 'absolute';
			box.style.top = dim.top + "px";
			box.style.left = dim.left + "px";
			box.style.opacity = object.savedOpacity;
			box.style.zIndex = zIndex++;

			if (object.templateVar &&
				DS_object[object.templateVar] &&
				!/\/0\.png$/.test(DS_object[object.templateVar]) && //Avoids showing transparent PNG
				typeof images[DS_object[object.templateVar]] !== 'undefined')
			{
				image.src = images[DS_object[object.templateVar]];
			} else {
				image.src = images[object.src];
			}

			image.width = dim.width;
			image.height =  dim.height;
			image.style.visibility = 'inherit';

			// Rotation
			if (object.angle) {
				addVendorPrefixes(image, 'transform', 'rotate('+object.angle+'deg)');
			}

			// Set Animation listeners
			box.onEntryEnd = [];
			box.onExitEnd = [];

			// Map object
			box.name = object.name;
			objectMap[object.id] = box;

			box.appendChild(image);
			canvas_container.appendChild(box);


			// verifica se é para inverter horiz./vertic.
			_flip(image, object);

			// visibilidade do texto e da caixa
			_visibility(box, object);

			// verifica as interaçõees com o objeto
			_interactions(box, object);

			// aplica animações
			_animations(object, box);
		};

		/**
		 * Renderiza os textos do tipo textbox do eadbuilder/menooh (extensão nossa criada para o fabric)
		 */
		this.textbox = function renderTextbox(object) {
			var box = document.createElement('div');
			box.setAttribute("id", object.id);
			box.style.position = 'absolute';

			var dim = calculateGenericDimensions(object);
			box.style.width = dim.width + "px";
			box.style.height = dim.height + "px";
			box.style.top = dim.top + "px";
			box.style.left = dim.left + "px";
			box.style.opacity = object.savedOpacity;
			box.style.zIndex = zIndex++;

			// Div for vertical alignment reference
			var vAlignDiv = document.createElement('div');
			vAlignDiv.style.position = 'relative';
			vAlignDiv.style.height = '100%';

			if (object.boxPath && images[object.boxPath]) {
				var imgWrapper = document.createElement('div'),
					imgBox = new Image();

				imgBox.src = images[object.boxPath];
				imgWrapper.style.width = dim.width;
				imgWrapper.style.height = dim.height;
				addVendorPrefixes(imgBox, 'transform', 'scale('+object.boxImageScaleX*globalScale.x+','+object.boxImageScaleY*globalScale.y+')');
				addVendorPrefixes(imgBox, 'transform-origin','0 0');

				// verifica se é para inverter horiz./vertic.
				_flip(imgWrapper, object);

				imgWrapper.appendChild(imgBox);
				vAlignDiv.appendChild(imgWrapper);
			}

			// Texto
			var p = document.createElement('p');
			p.style.position = 'absolute';
			p.style.margin = '0';
			p.style.webkitBackfaceVisibility = 'hidden';
			// Variável de Template
			if (object.templateVar && DS_object[object.templateVar]) {
				try { // URGH - Non standard templates
					p.innerHTML = decodeURIComponent(DS_object[object.templateVar]);
				} catch (err) {
					p.innerHTML = DS_object[object.templateVar];
				}
			} else {
				p.innerHTML = object.wrappedText.replace(/ /g, '&nbsp').replace(/\n/g, "<br />").replace(/\t/g, "&nbsp&nbsp");
			}
			if (object.boxPath) {
				// Padding proporcional à escala para  ciaxas de texto com imagem de fundo
				var padding = {
					leftRight : object.textPadding*object.scaleX*globalScale.x,
					top : object.textPadding*object.scaleY*globalScale.y + object.fontSize/8,
					bottom : object.textPadding*object.scaleY*globalScale.y
				};
				p.style.padding = padding.top+'px '+padding.leftRight+'px '+padding.bottom+'px';
				p.style.width = dim.width-(2*padding.leftRight) +'px';
			} else {
				p.style.padding = 10*globalScale.y + 'px ' + 10*globalScale.x +'px';
				p.style.width = dim.width-(20*globalScale.x) + 'px';
			}

			p.style.color = object.fill;
			p.style.fontFamily = object.fontFamily;
			p.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize+"px";
			p.style.fontStyle = object.fontStyle;
			p.style.fontWeight = object.fontWeight;
			p.style.textDecoration = object.textDecoration;
			p.style.textAlign = object.textAlign;
			p.style.lineHeight = object.lineHeight;
			p.style.wordBreak = 'break-word';

			// Vertical Alignment
			switch (object.vAlign) {
				case 'top':
					p.style.top = 0;
					break;
				case 'center':
					p.style.top = '50%';
					addVendorPrefixes(p, 'transform', 'translateY(-50%)');
					break;
				case 'bottom':
					p.style.bottom = '0';
					break;
			}

			// Rotation
			if (object.angle) {
				addVendorPrefixes(vAlignDiv, 'transform', 'rotate('+object.angle+'deg)');
			}

			// verifica se tem link
			if (object.linkUrl) {
				box.setAttribute('onclick', "global.location='" + object.linkUrl + "'");
				box.setAttribute('title', object.linkUrl);
				addClass(box, 'clickable');
			}

			vAlignDiv.appendChild(p);
			// Set Animation listeners
			box.onEntryEnd = [];
			box.onExitEnd = [];

			// Map object
			box.name = object.name;
			objectMap[object.id] = box;

			box.appendChild(vAlignDiv);
			canvas_container.appendChild(box);


			// visibilidade do texto e da caixa
			_visibility(box, object);

			// verifica as interaçõees com o objeto
			_interactions(box, object);

			// aplica animações
			_animations(object, box);
		};

		/**
		 * Renderiza um retângulo
		 */
		this.rect = function renderRect(object) {
			var box = document.createElement('div');
			box.setAttribute("id", object.id);
			box.style.position = "absolute";

			var dim = calculateGenericDimensions(object);
			box.style.width = dim.width + "px";
			box.style.height = dim.height + "px";
			box.style.top = dim.top + "px";
			box.style.left = dim.left + "px";
			box.style.opacity = object.savedOpacity;
			box.style.zIndex = zIndex++;

			var svgRoot = document.createElementNS(xmlns, 'svg'),
				svgGroup = document.createElementNS(xmlns, 'g'),
				svgRect = document.createElementNS(xmlns, 'rect');

			// Set Rectangle
			svgRect.setAttributeNS(null, 'width', object.width);
			svgRect.setAttributeNS(null, 'height', object.height);
			if (object.fill) {
				svgRect.setAttributeNS(null, 'fill', object.fill);
			} else {
				svgRect.setAttributeNS(null, 'fill', 'none');
			}
			if (object.stroke && object.strokeWidth > 0) {
				svgRect.setAttributeNS(null, 'stroke', object.stroke);
				svgRect.setAttributeNS(null, 'stroke-width', object.strokeWidth);
			}
			svgGroup.appendChild(svgRect);

			// Set Group
			var transformString = 'scale('+object.scaleX+','+object.scaleY+')';
			if (object.strokeWidth > 0) {
				transformString += ' translate('+object.strokeWidth/2+','+object.strokeWidth/2+')';
			}
			svgGroup.setAttributeNS(null, 'transform', transformString);
			svgRoot.appendChild(svgGroup);

			// Set Root
			svgRoot.style.position = 'relative';
			svgRoot.style.top = 0;
			svgRoot.style.left = 0;
			var SVGBBox = {
				width : object.width*object.scaleX,
				height : object.height*object.scaleY
			};
			if (object.strokeWidth > 0) {
				SVGBBox.width += object.strokeWidth*object.scaleX;
				SVGBBox.height += object.strokeWidth*object.scaleY;
				svgRoot.style.left = -object.strokeWidth*object.scaleX/2 + 'px';
				svgRoot.style.top = -object.strokeWidth*object.scaleY/2 + 'px';
			}
			svgRoot.setAttributeNS(null,'width',SVGBBox.width);
			svgRoot.setAttributeNS(null,'height',SVGBBox.height);

			// Rotation
			if (object.angle) {
				addVendorPrefixes(svgRoot, 'transform', 'rotate('+object.angle+'deg)');
			}

			// Global Scale
			var divGlobalScale = document.createElement('div');
			addVendorPrefixes(divGlobalScale, 'transform', 'scale('+globalScale.x+','+globalScale.y+')');
			addVendorPrefixes(divGlobalScale, 'transform-origin', '0 0');
			divGlobalScale.appendChild(svgRoot);

			// Set Animation listeners
			box.onEntryEnd = [];
			box.onExitEnd = [];

			// Map object
			box.name = object.name;
			objectMap[object.id] = box;

			box.appendChild(divGlobalScale);
			canvas_container.appendChild(box);

			// verifica as interaçõees com o objeto
			_interactions(box, object);

			// aplica animações
			_animations(object, box);
		};

		/**
		 * Renderiza um círculo
		 */
		this.circle = function renderCircle(object) {
			var box = document.createElement('div');
			box.setAttribute("id", object.id);
			box.style.position = "absolute";


			var dim = calculateGenericDimensions(object);
			box.style.width = dim.width + "px";
			box.style.height = dim.height + "px";
			box.style.top = dim.top + "px";
			box.style.left = dim.left + "px";
			box.style.opacity = object.savedOpacity;
			box.style.zIndex = zIndex++;

			var svgRoot = document.createElementNS(xmlns, 'svg'),
				svgGroup = document.createElementNS(xmlns, 'g'),
				svgCircle = document.createElementNS(xmlns, 'circle');

			// Set Circle
			var cx = object.width/2,
				cy = object.height/2,
				r = object.radius;
			svgCircle.setAttributeNS(null, 'cx', cx);
			svgCircle.setAttributeNS(null, 'cy', cy);
			svgCircle.setAttributeNS(null, 'r', r);
			if (object.fill) {
				svgCircle.setAttributeNS(null, 'fill', object.fill);
			} else {
				svgCircle.setAttributeNS(null, 'fill', 'none');
			}
			if (object.stroke && object.strokeWidth > 0) {
				svgCircle.setAttributeNS(null, 'stroke', object.stroke);
				svgCircle.setAttributeNS(null, 'stroke-width', object.strokeWidth);
			}
			svgGroup.appendChild(svgCircle);

			// Set Group
			var transformString = 'scale('+object.scaleX+','+object.scaleY+')';
			if (object.strokeWidth > 0) {
				transformString += ' translate('+object.strokeWidth/2+','+object.strokeWidth/2+')';
			}
			svgGroup.setAttributeNS(null, 'transform', transformString);
			svgRoot.appendChild(svgGroup);

			// Set Root
			svgRoot.style.position = 'relative';
			svgRoot.style.top = 0;
			svgRoot.style.left = 0;
			var SVGBBox = {
				width : object.width*object.scaleX,
				height : object.height*object.scaleY
			};
			if (object.strokeWidth > 0) {
				SVGBBox.width += object.strokeWidth*object.scaleX;
				SVGBBox.height += object.strokeWidth*object.scaleY;
				svgRoot.style.left = -object.strokeWidth*object.scaleX/2 + 'px';
				svgRoot.style.top = -object.strokeWidth*object.scaleY/2 + 'px';
			}
			svgRoot.setAttributeNS(null,'width',SVGBBox.width);
			svgRoot.setAttributeNS(null,'height',SVGBBox.height);

			// Rotation
			if (object.angle) {
				addVendorPrefixes(svgRoot, 'transform', 'rotate('+object.angle+'deg)');
			}

			// Global Scale
			var divGlobalScale = document.createElement('div');
			addVendorPrefixes(divGlobalScale, 'transform', 'scale('+globalScale.x+','+globalScale.y+')');
			addVendorPrefixes(divGlobalScale, 'transform-origin', '0 0');
			divGlobalScale.appendChild(svgRoot);

			// Set Animation listeners
			box.onEntryEnd = [];
			box.onExitEnd = [];

			// Map object
			box.name = object.name;
			objectMap[object.id] = box;

			box.appendChild(divGlobalScale);
			canvas_container.appendChild(box);

			// verifica as interaçõees com o objeto
			_interactions(box, object);

			// aplica animações
			_animations(object, box);
		};

		/**
		 * Type: path
		*/
		this.path = function renderPath (object) {
			var box = document.createElement('div');
			box.setAttribute("id", object.id);
			box.style.position = "absolute";

			var dim = calculateGenericDimensions(object);
			box.style.width = dim.width + "px";
			box.style.height = dim.height + "px";
			box.style.top = dim.top + "px";
			box.style.left = dim.left + "px";
			box.style.opacity = object.savedOpacity;
			box.style.zIndex = zIndex++;

			var svgRoot = document.createElementNS(xmlns, 'svg'),
				svgGroup = document.createElementNS(xmlns, 'g'),
				svgPath = document.createElementNS(xmlns, 'path');

			// Set Path como objeto SVG
			svgPath.setAttributeNS(null, 'd', getSVGPathString());
			if (object.fill) {
				svgPath.setAttributeNS(null, 'fill', object.fill);
			} else {
				svgPath.setAttributeNS(null, 'fill', 'none');
			}
			if (object.stroke && object.strokeWidth > 0) {
				svgPath.setAttributeNS(null, 'stroke', object.stroke);
				svgPath.setAttributeNS(null, 'stroke-width', object.strokeWidth);
			}
			svgGroup.appendChild(svgPath);

			// Set Group
			var transformString = 'scale('+object.scaleX+','+object.scaleY+')';
			if (object.strokeWidth > 0) {
				transformString += ' translate('+object.strokeWidth/2+','+object.strokeWidth/2+')';
			}
			svgGroup.setAttributeNS(null, 'transform', transformString);
			svgRoot.appendChild(svgGroup);

			// Set Root
			svgRoot.style.position = 'relative';
			svgRoot.style.top = 0;
			svgRoot.style.left = 0;
			var SVGBBox = {
				width : object.width*object.scaleX,
				height : object.height*object.scaleY
			};
			if (object.strokeWidth > 0) {
				SVGBBox.width += object.strokeWidth*object.scaleX*2; // Não sei porque, mas path precisa do x2
				SVGBBox.height += object.strokeWidth*object.scaleY*2;
				svgRoot.style.left = -object.strokeWidth*object.scaleX/2 + 'px';
				svgRoot.style.top = -object.strokeWidth*object.scaleY/2 + 'px';
			}
			svgRoot.setAttributeNS(null,'width',SVGBBox.width);
			svgRoot.setAttributeNS(null,'height',SVGBBox.height);

			// Rotation
			if (object.angle) {
				addVendorPrefixes(svgRoot, 'transform', 'rotate('+object.angle+'deg)');
			}

			// Global Scale
			var divGlobalScale = document.createElement('div');
			addVendorPrefixes(divGlobalScale, 'transform', 'scale('+globalScale.x+','+globalScale.y+')');
			addVendorPrefixes(divGlobalScale, 'transform-origin', '0 0');
			divGlobalScale.appendChild(svgRoot);

			// Set Animation listeners
			box.onEntryEnd = [];
			box.onExitEnd = [];

			// Map object
			box.name = object.name;
			objectMap[object.id] = box;

			box.appendChild(divGlobalScale);
			canvas_container.appendChild(box);

			// verifica se é para inverter horiz./vertic.
			_flip(svgRoot, object);

			// visibilidade
			_visibility(box, object);

			// verifica as interaçõees com o objeto
			_interactions(box, object);

			// aplica animações
			_animations(object, box);

			function getSVGPathString() {
				var path = object.path,
					lastCmd = "M",
					string = "M" + path[0][1] + "," + path[0][2],
					pathLength = path.length,
					endString = string + ',z';
				for (var i = 1; i<pathLength; i++) {
					if (path[i][0] != lastCmd) {
						string += path[i][0];
						lastCmd = path[i][0];
					} else {
						string += ",";
					}
					var args = path[i].length;
					for (var j=1; j<args; j++) {
						string += path[i][j];
						if (j<args-1) {
							string += ",";
						}
					}
				}
				return string+endString;
			}
		};

		this.line = function renderLine(object) {
			var box = document.createElement('div');
			box.setAttribute("id", object.id);
			box.style.position = "absolute";

			var dim = calculateGenericDimensions(object);
			box.style.width = dim.width + "px";
			box.style.height = dim.height + "px";
			box.style.top = dim.top + "px";
			box.style.left = dim.left + "px";
			box.style.opacity = object.savedOpacity;
			box.style.zIndex = zIndex++;

			var svgRoot = document.createElementNS(xmlns, 'svg'),
				svgGroup = document.createElementNS(xmlns, 'g'),
				svgLine = document.createElementNS(xmlns, 'line');

			// Setup Line
			svgLine.setAttributeNS(null, 'x1', object.x1);
			svgLine.setAttributeNS(null, 'x2', object.x2);
			svgLine.setAttributeNS(null, 'y1', object.y1);
			svgLine.setAttributeNS(null, 'y2', object.y2);
			if (object.fill) {
				svgLine.setAttributeNS(null, 'stroke', object.fill);
			} else {
				svgLine.setAttributeNS(null, 'fill', 'none');
			}
			if (object.strokeWidth > 0) {
				svgLine.setAttributeNS(null, 'stroke-width', object.strokeWidth);
			}
			svgGroup.appendChild(svgLine);

			// Set Group
			var transformString = 'scale('+object.scaleX+','+object.scaleY+')';
			if (object.strokeWidth > 0) {
				transformString += ' translate('+object.strokeWidth/2+','+object.strokeWidth/2+')';
			}
			svgGroup.setAttributeNS(null, 'transform', transformString);
			svgRoot.appendChild(svgGroup);

			// Set Root
			svgRoot.style.position = 'relative';
			svgRoot.style.top = 0;
			svgRoot.style.left = 0;
			var SVGBBox = {
				width : object.width*object.scaleX,
				height : object.height*object.scaleY
			};
			if (object.strokeWidth > 0) {
				SVGBBox.width += object.strokeWidth*object.scaleX;
				SVGBBox.height += object.strokeWidth*object.scaleY;
				svgRoot.style.left = -object.strokeWidth*object.scaleX/2 + 'px';
				svgRoot.style.top = -object.strokeWidth*object.scaleY/2 + 'px';
			}
			svgRoot.setAttributeNS(null,'width',SVGBBox.width);
			svgRoot.setAttributeNS(null,'height',SVGBBox.height);

			// Rotation
			if (object.angle) {
				addVendorPrefixes(svgRoot, 'transform', 'rotate('+object.angle+'deg)');
			}

			// Global Scale
			var divGlobalScale = document.createElement('div');
			addVendorPrefixes(divGlobalScale, 'transform', 'scale('+globalScale.x+','+globalScale.y+')');
			addVendorPrefixes(divGlobalScale,'transform-origin','0 0');

			divGlobalScale.appendChild(svgRoot);

			// Set Animation listeners
			box.onEntryEnd = [];
			box.onExitEnd = [];

			// Map object
			box.name = object.name;
			objectMap[object.id] = box;

			box.appendChild(divGlobalScale);
			canvas_container.appendChild(box);

			// verifica se é para inverter horiz./vertic.
			_flip(svgRoot, object);

			// visibilidade
			_visibility(box, object);

			// verifica as interaçõees com o objeto
			_interactions(box, object);

			// aplica animações
			_animations(object, box);
		};

		this.video = function renderVideo(object, isBackground) {
			var dim = calculateGenericDimensions(object),
				box = document.createElement('div'),
				checkYTOffline = function() {
					canvas_container.appendChild(box);
					if (YTStatus) {
						// API loaded
						createYTPlayer();
					} else {
						// API Offline - Show loading div and listen to API Ready
						var divOffline = document.createElement('div'),
							spanText = document.createElement('span');
						divOffline.style.width = dim.width + 'px';
						divOffline.style.height = dim.height + 'px';
						divOffline.setAttribute('class', 'YTOffline');
						divOffline.innerHTML = '<div class="loadContainer"><div class="loader"></div></div>';

						spanText.innerHTML = 'Please check your internet connection';

						divOffline.appendChild(spanText);
						box.appendChild(divOffline);

						setTimeout(function() {
							spanText.style.opacity = 1;
						}, 200);

						global.onYouTubeIframeAPIReady = function() {
							setYTOnline();
							createYTPlayer();
						};
					}
				};


			if (object.videoProps.location == 'youtube') {
				checkYTOffline();
			} else {
				var haveDimensions = false;

				videoElement.style.top = dim.top;
				videoElement.style.left = dim.left;
				videoElement.style.zIndex = zIndex++;
				videoElement.style.opacity = object.savedOpacity;
				/* global isWebOS:true */
				if (!isWebOS) {
					// [Android 4.2+ - Reliable video resize only after the second timeupdate event]
					var timeupdateCallCount = 0;
					videoElement.addEventListener('timeupdate', function getVideoSize(e) {
						timeupdateCallCount++;
						if (!haveDimensions && videoElement.videoWidth > 0 && timeupdateCallCount > 1) {
							var scaleX = dim.width/videoElement.videoWidth,
							scaleY = dim.height/videoElement.videoHeight;
							videoElement.style.webkitTransformOrigin = '0 0';
							videoElement.style.transformOrigin = '0 0';
							videoElement.style.webkitTransform = 'scale('+scaleX+','+scaleY+')';
							videoElement.style.transform = 'scale('+scaleX+','+scaleY+')';
							videoElement.style.visibility = 'inherit';
							haveDimensions = true;
							videoElement.removeEventListener('timeupdate', getVideoSize);
						}
						videoPlaying = true;
					});
				} else {
					if (!isBackground) {
						videoElement.setAttribute('width', dim.width);
						videoElement.setAttribute('height', dim.height);
					}
					videoElement.addEventListener('playing', function showVideo(e) {
						videoElement.removeEventListener('playing', showVideo);
						videoElement.style.visibility = 'inherit';
						videoPlaying = true;
					});
				}
				if (firstLoad) {
					triggerVideoPlay = function() {
						videoElement.play();
					};
				} else {
					videoElement.play();
				}
				videoElement.addEventListener('ended', function(e) {
					videoPlaying = false;
				});
			}


			function createYTPlayer() {
				box.setAttribute("id", object.id);
				box.style.position = 'absolute';
				box.style.top = dim.top + "px";
				box.style.left = dim.left + "px";
				box.style.opacity = object.savedOpacity;
				box.style.zIndex = zIndex++;
				box.style.display = 'none';

				var youtubeId = youtube_parser(object.videoProps.url);

				YTPlayer = new YT.Player(object.id.toString(), {
					width: dim.width,
					height: dim.height,
					videoId: youtubeId,
					playerVars : {
						'autoplay' : 0,
						'html5' : 1,
						'controls': 0,
						'rel' : 0,
						'showinfo' : 0
					},
					events : {
						onReady : function (ev) {
							if (firstLoad) {
								triggerVideoPlay = function() {
									ev.target.playVideo();
								};
							} else {
								ev.target.playVideo();
							}
						},
						onStateChange : function (ev) {
							// Hold scene change until video is ended
							if (ev.data === 1) {
								videoPlaying = true;
								playerIFrame.style.display = 'block';
							}
							if (ev.data === 0) {
								videoPlaying = false;
							}
						}
					}
				});

				var playerIFrame  = document.getElementById(object.id);
				box = playerIFrame;
			}

			function youtube_parser(url){
				if(typeof(url) == 'undefined') {
					return '';
				}
				var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#\&\?]*).*/;
				var match = url.match(regExp);
				if (match&&match[7].length==11){
					return match[7];
				}else{
					console.error("URL do YouTube incorreta!");
				}
			}
		};

		this['path-group'] = function renderSVG(object) {
			var dim = calculateGenericDimensions(object), image = new Image(),
				box = document.createElement('div'),
				svgWrapper = document.createElement('div');

			box.setAttribute("id", object.id);
			box.style.position = 'absolute';
			box.style.top = dim.top + "px";
			box.style.left = dim.left + "px";
			box.style.opacity = object.savedOpacity;
			box.style.zIndex = zIndex++;

			if (object.templateVar &&
				DS_object[object.templateVar] &&
				typeof images[DS_object[object.templateVar]] !== 'undefined')
			{
				image.src = images[DS_object[object.templateVar]];
			} else {
				image.src = images[object.sourcePath];
			}

			if (!image.src.match(/undefined$/)) { // Fix for cenique players that don't like SVG images
				image.style.visibility = 'inherit';
			} else {
				image.style.visibility = 'hidden';
			}

			svgWrapper.style.width = dim.width;
			svgWrapper.style.height =  dim.height;
			addVendorPrefixes(svgWrapper, 'transform', 'scale('+dim.width/image.naturalWidth+','+dim.height/image.naturalHeight+')');
			addVendorPrefixes(svgWrapper, 'transform-origin','0 0');
			svgWrapper.appendChild(image);

			// Rotation
			if (object.angle) {
				addVendorPrefixes(image, 'transform', 'rotate('+object.angle+'deg)');
			}

			// Set Animation listeners
			box.onEntryEnd = [];
			box.onExitEnd = [];

			// Map object
			box.name = object.name;
			objectMap[object.id] = box;

			box.appendChild(svgWrapper);
			canvas_container.appendChild(box);

			// verifica se é para inverter horiz./vertic.
			_flip(image, object);

			// visibilidade do texto e da caixa
			_visibility(box, object);

			// verifica as interaçõees com o objeto
			_interactions(box, object);

			// aplica animações
			_animations(object, box);
		};

		this.datetime = function renderDateTimeWidget(object) {
			var box = document.createElement('div');
			box.setAttribute("id", object.id);
			box.style.position = 'absolute';

			var dim = calculateGenericDimensions(object);
			box.style.width = dim.width + "px";
			box.style.height = dim.height + "px";
			box.style.top = dim.top + "px";
			box.style.left = dim.left + "px";
			box.style.opacity = object.savedOpacity;
			box.style.zIndex = zIndex++;

			// Div for vertical alignment reference
			var vAlignDiv = document.createElement('div');
			vAlignDiv.style.position = 'relative';
			vAlignDiv.style.height = '100%';

			var timeElement, dateElement;
			if (object.display !== 'date') {
				// Create Time Widget
				timeElement = document.createElement('p');
				timeElement.style.position = 'absolute';
				timeElement.style.margin = '0';
				timeElement.style.webkitBackfaceVisibility = 'hidden';
				timeElement.style.width = dim.width + 'px';

				timeElement.style.color = object.time_fontColor;
				timeElement.style.fontFamily = object.time_fontFamily;
				timeElement.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.time_fontSize+"px";
				timeElement.style.textAlign = 'center';
				timeElement.style.lineHeight = '1.3';
				timeElement.innerHTML = global.moment().format(object.time_format);
				oneSecondIntervals.push(setInterval(function() {
					timeElement.innerHTML = global.moment().format(object.time_format);
				}, 1000));
			}
			if (object.display !== 'time') {
				// Create Date Widget
				dateElement = document.createElement('p');
				dateElement.style.position = 'absolute';
				dateElement.style.margin = '0';
				dateElement.style.webkitBackfaceVisibility = 'hidden';
				dateElement.style.width = dim.width + 'px';

				dateElement.style.color = object.date_fontColor;
				dateElement.style.fontFamily = object.date_fontFamily;
				dateElement.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.date_fontSize+"px";
				dateElement.style.textAlign = 'center';
				dateElement.style.lineHeight = '1.3';
				dateElement.innerHTML = global.moment().locale(object.date_locale).format(object.date_format);
			}

			switch (object.display) {
				case 'date':
					dateElement.style.top = '50%';
					addVendorPrefixes(dateElement, 'transform', 'translateY(-50%)');
					vAlignDiv.appendChild(dateElement);
					break;
				case 'time':
					timeElement.style.top = '50%';
					addVendorPrefixes(timeElement, 'transform', 'translateY(-50%)');
					vAlignDiv.appendChild(timeElement);
					break;
				default: //both
					timeElement.style.top = 10 * globalScale.y + 'px';
					vAlignDiv.appendChild(timeElement);
					dateElement.style.bottom = 10 * globalScale.y + 'px';
					vAlignDiv.appendChild(dateElement);
			}

			// Rotation
			if (object.angle) {
				addVendorPrefixes(vAlignDiv, 'transform', 'rotate('+object.angle+'deg)');
			}

			// Set Animation listeners
			box.onEntryEnd = [];
			box.onExitEnd = [];

			// Map object
			box.name = object.name;
			objectMap[object.id] = box;

			box.appendChild(vAlignDiv);
			canvas_container.appendChild(box);


			// visibilidade do texto e da caixa
			_visibility(box, object);

			// verifica as interaçõees com o objeto
			_interactions(box, object);

			// aplica animações
			_animations(object, box);
		};

		this.weather = function renderWeatherWidget(object) {
			if (dynamicData[object.id]) {
				var box = document.createElement('div');
				box.setAttribute("id", object.id);
				box.style.position = 'absolute';

				var dim = calculateGenericDimensions(object);
				box.style.top = dim.top + "px";
				box.style.left = dim.left + "px";
				box.style.opacity = object.savedOpacity;
				box.style.zIndex = zIndex++;

				// Width and Height depends on layout and number of extra forecasts
				var widgetWidth = dim.width,
					widgetHeight = dim.height,
					extraForecastDimension;
				if (object.layout === 'h') {
					extraForecastDimension = (object.width*0.33 + 10)*object.scaleX*globalScale.x;
					widgetWidth += object.forecasts * extraForecastDimension;
					box.style.left = dim.left - object.forecasts * extraForecastDimension/2 + 'px';
				} else {
					extraForecastDimension = (object.height*0.4 + 20)*object.scaleY*globalScale.y;
					widgetHeight += object.forecasts * extraForecastDimension;
					box.style.top = dim.top - object.forecasts * extraForecastDimension/2 + 'px';
				}
				box.style.width = widgetWidth + "px";
				box.style.height = widgetHeight + "px";

				// Div for vertical alignment reference
				var vAlignDiv = document.createElement('div');
				vAlignDiv.style.position = 'relative';
				vAlignDiv.style.height = '100%';

				// Yahoo Logo
				var logo = new Image();
				logo.src = images['img/yahoo_' + (object.logoTheme === 'light'? 'purple.png' : 'white.png')];
				logo.style.position = 'absolute';
				logo.style.bottom = '0';
				logo.style.right = '0';
				if (Math.min(globalScale.x, globalScale.y) < 1) {
					logo.width *= Math.min(globalScale.x, globalScale.y);
				}
				vAlignDiv.appendChild(logo);

				// Main Forecast Element
				var mainForecast = document.createElement('div');
				mainForecast.style.position = 'relative';
				mainForecast.style.width = dim.width + "px";
				mainForecast.style.height = dim.height + "px";

				if (object.locationDisplay) {
					var town = document.createElement('p');
					town.style.margin = '0';
					town.style.webkitBackfaceVisibility = 'hidden';
					town.style.color = object.fontColor;
					town.style.fontFamily = object.fontFamily;
					town.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize+"px";
					town.style.textAlign = 'left';
					town.style.lineHeight = '1.3';
					town.style.padding = 10*globalScale.y + 'px ' + (10*globalScale.x) + 'px';
					town.style.paddingBottom = '0';
					town.innerHTML = object.town;
					mainForecast.appendChild(town);

					var stateCountry = document.createElement('p');
					stateCountry.style.margin = '0';
					stateCountry.style.webkitBackfaceVisibility = 'hidden';
					stateCountry.style.padding = '0 ' + 10*globalScale.x +'px';
					stateCountry.style.color = object.fontColor;
					stateCountry.style.fontFamily = object.fontFamily;
					stateCountry.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize*0.6+"px";
					stateCountry.style.textAlign = 'left';
					stateCountry.style.lineHeight = '1.3';
					stateCountry.innerHTML = '';
					if (object.locationDisplay.indexOf('s') > 0) {
						stateCountry.innerHTML += object.state;
					}
					if (object.locationDisplay.indexOf('c') > 0) {
						if (object.locationDisplay.length === 3) {
							stateCountry.innerHTML += ', ';
						}
						stateCountry.innerHTML += object.country;
					}
					mainForecast.appendChild(stateCountry);
				}

				// Wrapper for forecast and temperatures
				var forecastWrapper = document.createElement('div');
				forecastWrapper.style.position = 'absolute';
				forecastWrapper.style.bottom = 4 * globalScale.y + 'px';
				forecastWrapper.style.width = '100%';

				// Weather Icon
				var forecastCondition  = document.createElement('p');
				forecastCondition.style.display = 'inline-block';
				forecastCondition.style.textAlign = 'center';
				forecastCondition.style.margin = '0';
				forecastCondition.style.width = '50%';
				forecastCondition.style.webkitBackfaceVisibility = 'hidden';
				var forecastIcon = document.createElement('span');
				forecastIcon.style.color = object.fontColor;
				forecastIcon.style.fontFamily = 'weathericons';
				forecastIcon.style.margin = '-100%';
				forecastIcon.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize*3.5+"px";
				forecastIcon.style.lineHeight = '1.3';
				forecastIcon.innerHTML = String.fromCharCode(dynamicData[object.id].mainForecast.icon);
				forecastCondition.appendChild(forecastIcon);
				forecastWrapper.appendChild(forecastCondition);
				mainForecast.appendChild(forecastWrapper);

				// Temperature box
				var temperatureWrapper = document.createElement('div');
				temperatureWrapper.style.display = 'inline-block';
				temperatureWrapper.style.verticalAlign = 'top';
				temperatureWrapper.style.width = '50%';
				forecastWrapper.appendChild(temperatureWrapper);

				var maxTemp = document.createElement('p');
				maxTemp.style.margin = '0';
				maxTemp.style.webkitBackfaceVisibility = 'hidden';
				maxTemp.style.width = '100%';
				maxTemp.style.color = object.maxTempColor;
				maxTemp.style.fontFamily = object.fontFamily;
				maxTemp.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize*2+"px";
				maxTemp.style.textAlign = 'left';
				maxTemp.style.lineHeight = '1.3';
				maxTemp.innerHTML = dynamicData[object.id].mainForecast.max + '&deg;';
				temperatureWrapper.appendChild(maxTemp);

				var minTemp = document.createElement('p');
				minTemp.style.margin = 2*globalScale.y + 'px 0 0 0';
				minTemp.style.webkitBackfaceVisibility = 'hidden';
				addVendorPrefixes(minTemp, 'transform', 'translateY(-50%)');
				minTemp.style.width = '100%';
				minTemp.style.color = object.minTempColor;
				minTemp.style.fontFamily = object.fontFamily;
				minTemp.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize+"px";
				minTemp.style.textAlign = 'left';
				minTemp.style.lineHeight = '1.3';
				minTemp.style.paddingLeft = 2*globalScale.x + 'px';
				minTemp.innerHTML = dynamicData[object.id].mainForecast.min + '&deg;';
				temperatureWrapper.appendChild(minTemp);

				vAlignDiv.appendChild(mainForecast);

				// Extra forecasts
				if (object.forecasts > 0) {
					// Setup Line
					var svgRoot = document.createElementNS(xmlns, 'svg'),
						svgGroup = document.createElementNS(xmlns, 'g'),
						svgLine = document.createElementNS(xmlns, 'line');

					svgLine.setAttributeNS(null, 'x1', 0);
					svgLine.setAttributeNS(null, 'y1', 0);
					svgLine.setAttributeNS(null, 'stroke', object.fontColor);
					svgGroup.appendChild(svgLine);
					svgRoot.appendChild(svgGroup);
					svgRoot.style.position = 'absolute';
					svgRoot.style.opacity = 0.3;

					if (object.layout === 'h') {
						svgLine.setAttributeNS(null, 'x2', 0);
						svgLine.setAttributeNS(null, 'y2', dim.height*0.8);
						svgLine.setAttributeNS(null, 'stroke-width', globalScale.x);
						svgRoot.style.top = '50%';
						svgRoot.style.right = '2px';
						svgRoot.style.width = globalScale.x + 'px';
						svgRoot.style.height = dim.height*0.8 + 'px';
						addVendorPrefixes(svgRoot, 'transform', 'translateY(-50%)');
					} else {
						svgLine.setAttributeNS(null, 'x2', object.height*object.scaleX*globalScale.x*0.8);
						svgLine.setAttributeNS(null, 'y2', 0);
						svgLine.setAttributeNS(null, 'stroke-width', globalScale.y);
						svgRoot.style.bottom = '2px';
						svgRoot.style.left = '50%';
						svgRoot.style.width = object.height*object.scaleX*globalScale.x*0.8 + 'px';
						svgRoot.style.height = globalScale.y + 'px';
						addVendorPrefixes(svgRoot, 'transform', 'translateX(-50%)');
					}
					mainForecast.appendChild(svgRoot);

					var extraForecastsTable = document.createElement('table'), i,
						forecast, day, iconWrap, iconText, fMax, fMin;

					extraForecastsTable.style.borderSpacing = 0;

					if (object.layout === 'h') {
						extraForecastsTable.style.width = widgetWidth - dim.width + 'px';
						extraForecastsTable.style.position = 'absolute';
						extraForecastsTable.style.top = '50%';
						extraForecastsTable.style.right = '0';
						addVendorPrefixes(extraForecastsTable, 'transform', 'translateY(-50%)');

						var extraForecastsRow  = document.createElement('tr');
						for (i = 0; i < object.forecasts; i++) {
							// Safeguard
							if (!dynamicData[object.id].extraForecasts[i]) {
								break;
							}
							forecast = document.createElement('td');
							day      = document.createElement('div');
							iconWrap = document.createElement('div');
							iconText = document.createElement('span');
							fMax     = document.createElement('div');
							fMin     = document.createElement('div');

							forecast.style.height = dim.height*0.8+'px';
							forecast.style.position = 'relative';
							forecast.style.padding = '0';

							day.style.width = '100%';
							day.style.margin = '0';
							day.style.webkitBackfaceVisibility = 'hidden';
							day.style.color = object.fontColor;
							day.style.fontFamily = object.fontFamily;
							day.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize*0.6+"px";
							day.style.textAlign = 'center';
							day.style.lineHeight = '1.3';
							day.style.position = 'absolute';
							day.style.top = '0';
							day.innerHTML = global.moment().add(i+1,'d').locale(object.date_locale).format('ddd');
							forecast.appendChild(day);

							iconText.style.color = object.fontColor;
							iconText.style.webkitBackfaceVisibility = 'hidden';
							iconText.style.fontFamily = object.fontFamily;
							iconText.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize*2.4+"px";
							iconText.style.fontFamily = 'weathericons';
							iconText.style.lineHeight = '1.3';
							iconText.style.margin = '-100%';
							iconText.innerHTML = String.fromCharCode(dynamicData[object.id].extraForecasts[i].icon);
							iconWrap.appendChild(iconText);

							iconWrap.style.width = '100%';
							iconWrap.style.margin = '0';
							iconWrap.style.textAlign = 'center';
							iconWrap.style.display = 'inline-block';
							iconWrap.style.position = 'absolute';
							iconWrap.style.top = '50%';
							addVendorPrefixes(iconWrap, 'transform', 'translateY(-50%)');
							forecast.appendChild(iconWrap);

							fMax.style.margin = '0';
							fMax.style.webkitBackfaceVisibility = 'hidden';
							fMax.style.width = object.width*globalScale.x/6 + 'px';
							fMax.style.color = object.maxTempColor;
							fMax.style.fontFamily = object.fontFamily;
							fMax.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize*0.6+"px";
							fMax.style.textAlign = 'center';
							fMax.style.lineHeight = '1.3';
							fMax.style.position = 'absolute';
							fMax.style.bottom = '0';
							fMax.style.left = '50%';
							fMax.innerHTML = dynamicData[object.id].extraForecasts[i].max + '&deg;';
							forecast.appendChild(fMax);

							fMin.style.margin = '0';
							fMin.style.webkitBackfaceVisibility = 'hidden';
							fMin.style.width = object.width*globalScale.x/6 + 'px';
							fMin.style.color = object.minTempColor;
							fMin.style.fontFamily = object.fontFamily;
							fMin.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize*0.6+"px";
							fMin.style.textAlign = 'center';
							fMin.style.lineHeight = '1.3';
							fMin.style.position = 'absolute';
							fMin.style.bottom = '0';
							fMin.style.right = '50%';
							fMin.innerHTML = dynamicData[object.id].extraForecasts[i].min + '&deg;';
							forecast.appendChild(fMin);

							extraForecastsRow.appendChild(forecast);
						}
						extraForecastsTable.appendChild(extraForecastsRow);
					} else {
						var rowHeight = (widgetHeight - dim.height)/object.forecasts;

						for (i = 0; i < object.forecasts; i++) {
							// Safeguard
							if (!dynamicData[object.id].extraForecasts[i]) {
								break;
							}
							var row = document.createElement('tr'),
								cell = document.createElement('td');

							forecast = document.createElement('div');
							day      = document.createElement('div');
							iconWrap = document.createElement('div');
							iconText = document.createElement('span');
							fMax     = document.createElement('div');
							fMin     = document.createElement('div');

							cell.style.padding = 0;
							cell.appendChild(forecast);

							row.style.height = rowHeight + 'px';
							row.style.verticalAlign = 'middle';
							row.appendChild(cell);

							forecast.style.width = dim.width+'px';
							forecast.style.position = 'relative';

							day.style.margin = '0';
							day.style.webkitBackfaceVisibility = 'hidden';
							day.style.color = object.fontColor;
							day.style.fontFamily = object.fontFamily;
							day.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize+"px";
							day.style.textAlign = 'center';
							day.style.lineHeight = '1.3';
							day.style.position = 'absolute';
							day.style.left = '0';
							day.style.top = '50%';
							addVendorPrefixes(day, 'transform', 'translateY(-50%)');
							day.style.width = dim.width/3 + 'px';
							day.innerHTML = global.moment().add(i+1,'d').locale(object.date_locale).format('ddd');
							forecast.appendChild(day);

							iconText.style.margin = '-100%';
							iconText.style.webkitBackfaceVisibility = 'hidden';
							iconText.style.color = object.fontColor;
							iconText.style.fontFamily = 'weathericons';
							iconText.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize*3+"px";
							iconText.style.lineHeight = '1.3';
							iconText.innerHTML = String.fromCharCode(dynamicData[object.id].extraForecasts[i].icon);
							iconWrap.appendChild(iconText);

							iconWrap.style.margin = '0';
							iconWrap.style.display = 'inline-block';
							iconWrap.style.textAlign = 'center';
							iconWrap.style.position = 'absolute';
							iconWrap.style.top = '50%';
							iconWrap.style.left = '50%';
							iconWrap.style.width = dim.width/3 + 'px';
							addVendorPrefixes(iconWrap, 'transform', 'translate(-50%, -50%)');
							forecast.appendChild(iconWrap);

							fMax.style.margin = '0';
							fMax.style.webkitBackfaceVisibility = 'hidden';
							fMax.style.color = object.maxTempColor;
							fMax.style.fontFamily = object.fontFamily;
							fMax.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize+"px";
							fMax.style.textAlign = 'center';
							fMax.style.lineHeight = '1.3';
							fMax.style.position = 'absolute';
							fMax.style.bottom = '50%';
							fMax.style.right = '0';
							fMax.style.width = dim.width/3 + 'px';
							fMax.innerHTML = dynamicData[object.id].extraForecasts[i].max + '&deg;';
							forecast.appendChild(fMax);

							fMin.style.margin = '0';
							fMin.style.webkitBackfaceVisibility = 'hidden';
							fMin.style.color = object.minTempColor;
							fMin.style.fontFamily = object.fontFamily;
							fMin.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize+"px";
							fMin.style.textAlign = 'center';
							fMin.style.lineHeight = '1.3';
							fMin.style.position = 'absolute';
							fMin.style.top = '50%';
							fMin.style.right = '0';
							fMin.style.width = dim.width/3 + 'px';
							fMin.innerHTML = dynamicData[object.id].extraForecasts[i].min + '&deg;';
							forecast.appendChild(fMin);

							extraForecastsTable.appendChild(row);
						}
					}
					vAlignDiv.appendChild(extraForecastsTable);
				}

				// Rotation
				if (object.angle) {
					addVendorPrefixes(vAlignDiv, 'transform', 'rotate('+object.angle+'deg)');
				}

				box.appendChild(vAlignDiv);
				canvas_container.appendChild(box);

				// Set Animation listeners
				box.onEntryEnd = [];
				box.onExitEnd = [];

				// Map object
				box.name = object.name;
				objectMap[object.id] = box;

				// visibilidade do texto e da caixa
				_visibility(box, object);

				// verifica as interaçõees com o objeto
				_interactions(box, object);

				// aplica animações
				_animations(object, box);
			}
		};

		this.finance = function renderFinanceWidget(object) {
			if (!dynamicData[object.id]) return;

			var box = document.createElement('div');
			box.setAttribute("id", object.id);
			box.style.position = 'absolute';

			var dim = calculateGenericDimensions(object);
			box.style.width = dim.width + "px";
			box.style.height = dim.height + "px";
			box.style.top = dim.top + "px";
			box.style.left = dim.left + "px";
			box.style.opacity = object.savedOpacity;
			box.style.zIndex = zIndex++;

			// Div for vertical alignment reference
			var vAlignDiv = document.createElement('div');
			vAlignDiv.style.position = 'relative';
			vAlignDiv.style.height = '100%';

			// Texto
			var p = document.createElement('p');
			p.style.position = 'absolute';
			p.style.margin = '0';
			p.style.webkitBackfaceVisibility = 'hidden';
			if (object.boxPath) {
				// Padding proporcional à escala para  ciaxas de texto com imagem de fundo
				var padding = {
					leftRight : object.textPadding*object.scaleX*globalScale.x,
					top : object.textPadding*object.scaleY*globalScale.y + object.fontSize/8,
					bottom : object.textPadding*object.scaleY*globalScale.y
				};
				p.style.padding = padding.top+'px '+padding.leftRight+'px '+padding.bottom+'px';
				p.style.width = dim.width-(2*padding.leftRight) +'px';
			} else {
			}
			p.style.padding = 10*globalScale.y + 'px ' + 10*globalScale.x +'px';
			p.style.width = dim.width-(20*globalScale.x) + 'px';

			p.style.color = object.fill;
			p.style.fontFamily = object.fontFamily;
			p.style.fontSize = Math.min(globalScale.x,globalScale.y)*object.fontSize+"px";
			p.style.fontStyle = object.fontStyle;
			p.style.fontWeight = object.fontWeight;
			p.style.textDecoration = object.textDecoration;
			p.style.textAlign = object.textAlign;
			p.style.lineHeight = object.lineHeight;
			p.style.wordBreak = 'break-word';


			// Dynamic data
			var financeData = dynamicData[object.id];
			var currency = object.sourceSymbol.letter;
			var text = '';

			if (!financeData[currency]) return;

			if (object.variationDisplay === 'both' || object.variationDisplay === 'symbol') {
				if (financeData[currency].variation < 0) {
					text = '\u25BC ';
				} else if (financeData[currency].variation > 0) {
					text = '\u25B2 ';
				} else {
					text = '= ';
				}
			}
			text += object.targetSymbol[object.symbolFormat] + ' ';
			text += financeData[currency].rate.toFixed(object.displayFormat.precision);
			if (object.displayFormat.variation) {
				text += ' (';
				if (financeData[currency].variation > 0) {
					text += '+';
				}
				text += financeData[currency].variation.toFixed(object.displayFormat.precision) + ')';
			}
			if (object.displayFormat.decimal === ',') {
				text = text.replace(/\./g,',');
			}
			p.innerHTML = text;
			if (object.variationDisplay === 'both' || object.variationDisplay === 'color') {
				if (financeData[currency].variation < 0) {
					p.style.color = object.lowFontColor;
				} else if (financeData[currency].variation > 0) {
					p.style.color = object.highFontColor;
				}
			}

			// Vertical Alignment
			switch (object.vAlign) {
				case 'top':
					p.style.top = 0;
					break;
				case 'center':
					p.style.top = '50%';
					addVendorPrefixes(p, 'transform', 'translateY(-50%)');
					break;
				case 'bottom':
					p.style.bottom = '0';
					break;
			}

			// Rotation
			if (object.angle) {
				addVendorPrefixes(vAlignDiv, 'transform', 'rotate('+object.angle+'deg)');
			}

			vAlignDiv.appendChild(p);
			// Set Animation listeners
			box.onEntryEnd = [];
			box.onExitEnd = [];

			// Map object
			box.name = object.name;
			objectMap[object.id] = box;

			box.appendChild(vAlignDiv);
			canvas_container.appendChild(box);


			// visibilidade do texto e da caixa
			_visibility(box, object);

			// verifica as interaçõees com o objeto
			_interactions(box, object);

			// aplica animações
			_animations(object, box);
		};

		/******************************************************
		 ** métodos privados para auxiliar a aplicar algumas  *
		 ** mudanças nos elementos após gerados               *
		 ******************************************************/
		// inverter horizontalmente e verticalmente
		function _flip(element, object) {
			var transform = element.style.transform || element.style.webkitTransform || "";

			if (object.flipX && object.flipY) {
				transform += ' scaleY(-1) scaleX(-1)';
				element.style.webkitTransform = transform;
				element.style.transform = transform;
				// addClass(element, "flipXY");
			} else if (object.flipX) {
				transform += ' scaleX(-1)';
				element.style.webkitTransform = transform;
				element.style.transform = transform;
				// addClass(element, "flipX");
			} else if (object.flipY) {
				transform += ' scaleY(-1)';
				element.style.webkitTransform = transform;
				element.style.transform = transform;
				// addClass(element, "flipY");
			}
		}

		// verificar status inicial visible/invisible
		function _visibility(element, object) {
			if (object.invisible) {
				element.style.visibility = 'hidden';
			}
		}

		// verifica interações
		function _interactions(element, object) {
			if (object.interactions) {
				// adiciona o cursor especial
				addClass(element, 'clickable');

				// ativa as interações
				var ints = object.interactions;
				for (var i in ints) {
					if (interaction[ints[i].event]) {
						interaction[ints[i].event](element, ints[i].action, ints[i].target);
					}
				}
			}
		}

		// verifica e enfileira animações
		function _animations(object, element) {
			// Normalization
			if (object.animation) {
				object.entry = object.animation;
			}
			// Animação de Entrada
			if (object.entry) {
				if (animation[object.entry.type]) {
					animationQueue.push({
						fn : animation[object.entry.type],
						arguments : [object, element]
					});
				}
			}
			// Animação de Saída
			if (object.exit) {
				if (animation[object.exit.type]) {
					animationQueue.push({
						fn : animation[object.exit.type],
						arguments : [object, element, true]
					});
				}
			}
		}
	}

	var oldBGImage;
	function clearOldBackground() {
		var background = document.getElementById('background');
		if (oldBGImage) {
			// There is at least one BG that can be discarded
			if (oldBGImage.length) {
				oldBGImage.forEach(function(htmlElement) {
					if (htmlElement) {
						background.removeChild(htmlElement);
					}
				});
			} else {
				background.removeChild(oldBGImage);
			}
			oldBGImage = null;
		}
	}

	function Animation() {
		/**
		 * Implementa a animação slide para direita
		 */
		this.fromLeftToRight = function fromLeftToRight(object, element, isExitAnimation) {
			_slide(object, element, 'left', 'width', isExitAnimation);
		};

		/**
		 * Implementa a animação slide para direita
		 */
		this.fromRightToLeft = function fromRightToLeft(object, element, isExitAnimation) {
			_slide(object, element, 'right', 'width', isExitAnimation);
		};

		/**
		 * Implementa a animação slide para direita
		*/
		this.fromTopToBottom = function fromTopToBottom(object, element, isExitAnimation) {
			_slide(object, element, 'top', 'height', isExitAnimation);
		};

		/**
		 * Implementa a animação slide para direita
		*/
		this.fromBottomToTop = function fromBottomToTop(object, element, isExitAnimation) {
			_slide(object, element, 'bottom', 'height', isExitAnimation);
		};

		/**
		 * Implementa a animação de girar em sentido horário e antihorário
		*/
		this.spinClockwise = function spinClockwise(object, element, isExitAnimation) {
			_spin(object, element, 'clock');
		};
		this.spinCounterClockwise = function spinCounterClockwise(object, element, isExitAnimation) {
			_spin(object, element, 'counter');
		};

		/**
		 * Implementa a fades e zoom
		*/
		this.fadeIn = function fadeIn(object, element, isExitAnimation) {
			_fadeAndZoom(object, element, 'fade', isExitAnimation);
		};
		this.zoomIn = function zoomIn(object, element, isExitAnimation) {
			_fadeAndZoom(object, element, 'z+', isExitAnimation);
		};
		this.zoomOut = function zoomOut(object, element, isExitAnimation) {
			_fadeAndZoom(object, element, 'z-', isExitAnimation);
		};
		this.fadeInZoomIn = function fadeInZoomIn(object, element, isExitAnimation) {
			_fadeAndZoom(object, element, 'fadez+', isExitAnimation);
		};
		this.fadeInZoomOut = function fadeInZoomOut(object, element, isExitAnimation) {
			_fadeAndZoom(object, element, 'fadez-', isExitAnimation);
		};

		/**
		 * Animações extras de saída
		*/
		this.exitTop = function exitTop(object, element, isExitAnimation) {
			_slide(object, element, 'top', 'height', isExitAnimation);
		};
		this.exitRight = function exitRight(object, element, isExitAnimation) {
			_slide(object, element, 'right', 'width', isExitAnimation);
		};
		this.exitBottom = function exitBottom(object, element, isExitAnimation) {
			_slide(object, element, 'bottom', 'height', isExitAnimation);
		};
		this.exitLeft = function exitLeft(object, element, isExitAnimation) {
			_slide(object, element, 'left', 'width', isExitAnimation);
		};
		this.fadeOut = function fadeOut(object, element, isExitAnimation) {
			_fadeAndZoom(object, element, 'fade', isExitAnimation);
		};
		this.fadeOutZoomIn = function fadeOutZoomIn(object, element, isExitAnimation) {
			_fadeAndZoom(object, element, 'fadez+', isExitAnimation);
		};
		this.fadeOutZoomOut = function fadeOutZoomOut(object, element, isExitAnimation) {
			_fadeAndZoom(object, element, 'fadez-', isExitAnimation);
		};

		/**
		*	Constrói as transições CSS para animações.
		*
		*	@param {HTMLElement} Elemento HTML que vai receber as transições
		*	@param {Object} Objeto de configuração com os dados da transição
		*/
		function applyTransition(element, config) {
			if (!config.time) {
				config.time = 1;
			}

			// DEBUG BORDERS - Add a random color border to every animated element
			// element.style.border = '50px solid #' + (Math.random().toString(16) + '0000000').slice(2, 8);

			// element.style['-webkit-transition'] = 'transform ' + config.time + 's';
			// element.style['-moz-transition'] = 'transform ' + config.time + 's';
			// element.style['-ms-transition'] = 'transform ' + config.time + 's';
			// element.style['-o-transition'] = 'transform ' + config.time + 's';
			// element.style.transition = 'transform ' + config.time + 's';

			var property = config.property || 'transform',
				properties = config.properties || [property],
				transition = '';

			// Monta a transição de acordo com as propriedades
			for (var j = properties.length - 1; j >= 0; j--) {
				transition += properties[j] + ' ' + config.time + 's';
				if (config.timingFunction) {
					transition += ' ' + config.timingFunction;
				}
				if (j > 0) {
					transition += ', ';
				}
			}

			var delay = config.delay || 0,
				hideMe = function(e) {
					element.removeEventListener('webkitTransitionEnd', hideMe, false);
					element.removeEventListener('transitionend', hideMe, false);
					element.style.visibility = 'hidden';
				}, triggerAnimations = function(e) {
					element.removeEventListener('webkitTransitionEnd', triggerAnimations, false);
					element.removeEventListener('transitionend', triggerAnimations, false);
					var i;
					if (config.isExitAnimation) {
						for (i = 0; i < element.onExitEnd.length; i++) {
							element.onExitEnd[i]();
						}
					} else {
						for (i = 0; i < element.onEntryEnd.length; i++) {
							element.onEntryEnd[i]();
						}
					}
					// Set animation flag off for interactions
					if (typeof element.interactionAnimation !== 'undefined') {
						element.interactionAnimation.ongoing = false;
					}
				};

			if (!config.isExitAnimation) {
				// Animação de entrada
				setTimeout(function() {
					element.style.visibility = 'visible';
					if (config.opacity) {
						element.style.opacity = config.opacity;
					}
					element.style.webkitTransition = transition.replace(/transform/g,'-webkit-transform');
					element.style.transition = transition;
					element.style.webkitTransform = config.transform;
					element.style.transform = config.transform;
					// Configura triggers da animação de entrada
					element.addEventListener('webkitTransitionEnd', triggerAnimations);
					element.addEventListener('transitionend', triggerAnimations);
				}, delay*1000 + 100);
			} else {
				// Animação de saída
				setTimeout(function() {
					if (config.opacity) {
						element.style.opacity = config.opacity;
					}
					element.style.webkitTransition = transition.replace(/transform/g,'-webkit-transform');
					element.style.transition = transition;
					element.style.webkitTransform = config.transform;
					element.style.transform = config.transform;
					element.addEventListener('webkitTransitionEnd', hideMe);
					element.addEventListener('transitionend', hideMe);
					// Configura triggers da animação de entrada
					element.addEventListener('webkitTransitionEnd', triggerAnimations);
					element.addEventListener('transitionend', triggerAnimations);
				}, delay*1000 + 100);
			}
		}

		this._applyTransition = applyTransition;
		/**
		 * prepara as transições de slide via CSS3
		 */
		function _slide(object, element, property, helpProperty, isExitAnimation) {
			var dim = calculateGenericDimensions(object),
				properties = {},
				hProperty = ucfirst(helpProperty),
				animation = isExitAnimation? object.exit : object.entry,
				transitionConfig;

			// bottom e right devem ter a propriedade de trabalho alteradas para continuar
			var changedProperty = false;
			if (property != 'top' && property != 'left') {
				property = (property == 'bottom') ? 'top' : 'left';
				changedProperty = true;
			}

			var realPos, transformedPos;
			// Define o ponto real do objeto via CSS e o ponto onde ele deve estar após o transform
			realPos = dim[property];
			// Ignora a altura do Fabric e calcula a altura em pixels do textbox
			if (object.type == 'textbox' && helpProperty == 'height') {
				dim.height = element.querySelector('p').offsetHeight;
			}

			// Rotation angle affect the property to be changed
			if (Math.abs(object.angle) > 0) {
				// Get the greatest value and add a security Margin (square diagonal)
				var angledDim = Math.max(dim.width, dim.height)*Math.sqrt(2);
				if (!changedProperty) {
					transformedPos = -angledDim;
				} else {
					transformedPos = canvas_container['offset' + hProperty] + angledDim;
				}
			} else {
				if (!changedProperty) {
					transformedPos = -1.1*dim[helpProperty]; //10% Security Margin
				} else {
					transformedPos = canvas_container['offset' + hProperty] + dim[helpProperty]; //Adding the dimension as margin
				}
			}


			// Gera a função de transform
			var transformFunction = 'translate', distance;
			if (hProperty == 'Width') {
				transformFunction+='X';
			} else {
				transformFunction+='Y';
			}

			distance = transformedPos - realPos;
			// Constrói o objeto de configuração da transição
			if (!isExitAnimation){
				// Animação de entrada seta a transform antes do transition
				element.style.webkitTransform = transformFunction+'('+distance+'px)';
				element.style.transform = transformFunction+'('+distance+'px)';
				element.style.visibility = 'hidden';
				transitionConfig = {
					time : animation.duration,
					delay : animation.delay,
					transform : 'none',
					isExitAnimation : isExitAnimation,
					objectHasEntryAnimation : !!object.entry,
					original : {
						transform : transformFunction+'('+distance+'px)',
						transition : '',
						opacity : 1,
						visibility : 'hidden'
					}
				};
			} else {
				// Animação de saída seta a transform junto da transition
				transitionConfig = {
					time : animation.duration,
					delay : animation.delay,
					transform : transformFunction+'('+distance+'px)',
					isExitAnimation : isExitAnimation,
					objectHasEntryAnimation : !!object.entry,
					timingFunction : 'ease-in',
					original : {
						transform : '',
						transition : '',
						opacity : 1,
						visibility : 'inherit'
					}
				};
			}

			if (typeof element.interactionAnimation == 'undefined') {
				element.interactionAnimation = {};
			}
			if (isExitAnimation) {
				element.interactionAnimation.exit = transitionConfig;
			} else {
				element.interactionAnimation.entry = transitionConfig;
			}
			if (!animation.when || animation.when == 'base') {
				if (isExitAnimation && object.entry && object.entry.type) {
					element.onEntryEnd.push(animationEndListener(element, transitionConfig));
				} else {
					applyTransition(element, transitionConfig);
				}
			} else if (animation.when !== 'interaction') {
				var trigger = objectMap[animation.trigger];
				if (trigger) {
					if (animation.when == 'exit') {
						trigger.onExitEnd.push(animationEndListener(element, transitionConfig));
					} else if (animation.when == 'entry') {
						trigger.onEntryEnd.push(animationEndListener(element, transitionConfig));
					}
				}
			}
		}

		/**
		*	Animação de rotação
		*/
		function _spin(object, element, direction) {
			var rotationAngle = (object.entry.spins || 0) * 360,
				animation = object.entry,
				transitionConfig;
			if (direction == 'counter') {
				rotationAngle *= -1;
			}
			transitionConfig = {
				time : object.entry.duration,
				timingFunction : 'linear',
				delay : object.entry.delay,
				transform : 'rotate(' + rotationAngle + 'deg)',
				original : {
					transform : '',
					transition : '',
					opacity : 1,
					visibility : 'hidden'
				}
			};

			element.style.visibility = 'hidden';
			if (typeof element.interactionAnimation == 'undefined') {
				element.interactionAnimation = {};
			}
			element.interactionAnimation.entry = transitionConfig;

			if (!animation.when || animation.when == 'base') { // Default or legacy
				applyTransition(element, transitionConfig);
			} else if (animation.when !== 'interaction') {
				var trigger = objectMap[animation.trigger];
				if (trigger) {
					if (animation.when == 'exit') {
						trigger.onExitEnd.push(animationEndListener(element, transitionConfig));
					} else if (animation.when == 'entry') {
						trigger.onEntryEnd.push(animationEndListener(element, transitionConfig));
					}
				}
			}
		}

		/**
		*	Animação de fade(in/out) e zoom(in/out)
		*/
		function _fadeAndZoom (object, element, type, isExitAnimation) {
			var animation = isExitAnimation? object.exit : object.entry,
				transitionConfig = {
					properties : ['transform', 'opacity'],
					time : animation.duration,
					delay : animation.delay,
					isExitAnimation : isExitAnimation,
					objectHasEntryAnimation : !!object.entry,
				};

			// Normalization
			var savedOpacity = (typeof object.savedOpacity == 'number'?object.savedOpacity:1);
			if (isExitAnimation) {
				transitionConfig.original = {
					transform : '',
					transition : '',
					opacity : savedOpacity,
					visibility : 'inherit'
				};
				transitionConfig.timingFunction = 'ease-in';
				if (/fade/.test(type)) {
					transitionConfig.opacity = 0.01;
				}
				if (/z\+/.test(type)) {
					transitionConfig.transform = 'scale(4)';
				}
				if (/z-/.test(type)) {
					transitionConfig.transform = 'scale(0.25)';
				}
			} else {
				element.style.visibility = 'hidden';
				transitionConfig.original = {
					transform : '',
					transition : '',
					opacity : savedOpacity,
					visibility : 'hidden'
				};
				if (/fade/.test(type)) {
					element.style.opacity = 0.01;
					transitionConfig.original.opacity = 0.01;
					transitionConfig.opacity = savedOpacity;
				}
				if (/z\+/.test(type)) {
					element.style.webkitTransform = 'scale(0.25)';
					element.style.transform = 'scale(0.25)';
					transitionConfig.original.transform = 'scale(0.25)';
					transitionConfig.transform = 'scale(1)';
				}
				if (/z-/.test(type)) {
					element.style.webkitTransform = 'scale(4)';
					element.style.transform = 'scale(4)';
					transitionConfig.original.transform = 'scale(4)';
					transitionConfig.transform = 'scale(1)';
				}
			}

			if (typeof element.interactionAnimation == 'undefined') {
				element.interactionAnimation = {};
			}
			if (isExitAnimation) {
				element.interactionAnimation.exit = transitionConfig;
			} else {
				element.interactionAnimation.entry = transitionConfig;
			}
			if (!animation.when || animation.when == 'base') { // Default or legacy
				if (isExitAnimation && object.entry && object.entry.type) {
					element.onEntryEnd.push(animationEndListener(element, transitionConfig));
				} else {
					applyTransition(element, transitionConfig);
				}
			} else if (animation.when !== 'interaction') {
				var trigger = objectMap[animation.trigger];
				if (trigger) {
					if (animation.when == 'exit') {
						trigger.onExitEnd.push(animationEndListener(element, transitionConfig));
					} else if (animation.when == 'entry') {
						trigger.onEntryEnd.push(animationEndListener(element, transitionConfig));
					}
				}
			}
		}

		function animationEndListener (HTMLElement, transitionConfig) {
			return function() {
				applyTransition(HTMLElement,transitionConfig);
			};
		}
	}

	function Interaction() {
		var that = this;
		this.click = function onClick(element, action, target) {
			element.addEventListener('click', function() {
				if (that['_' + action]) {
					that['_' + action](target);
				}
			});
		};

		this.mousehover = function onMouseOver(element, action, target) {
			element.addEventListener('mouseover', function() {
				if (that['_' + action]) {
					that['_' + action](target);
				}
			});
			element.addEventListener('mouseout', function() {
				if (that['_' + action]) {
					that['_' + action](target);
				}
			});
		};

		this._show = function _show(elementId) {
			var target = document.getElementById(elementId),
				oldVisibility = getComputedStyle(target).visibility;
			if (oldVisibility !== 'visible') {
				if (target.interactionAnimation) {
					if (!target.interactionAnimation.ongoing && target.interactionAnimation.entry) {
						// Restore pre-animation state
						for (var cssProp in target.interactionAnimation.entry.original) {
							if (target.interactionAnimation.entry.original.hasOwnProperty(cssProp)) {
								addVendorPrefixes(target, cssProp, target.interactionAnimation.entry.original[cssProp]);
							}
						}
						// Flag to avoid triggering new animations while performing one
						target.interactionAnimation.ongoing = true;
						animation._applyTransition(target, target.interactionAnimation.entry);
					}
				} else {
					target.style.visibility = 'visible';
				}
			}
		};

		this._hide = function _hide(elementId) {
			var target = document.getElementById(elementId),
				oldVisibility = getComputedStyle(target).visibility;

			if (oldVisibility !== 'hidden') {
				if (target.interactionAnimation) {
					if (!target.interactionAnimation.ongoing && target.interactionAnimation.exit) {
						// Restore pre-animation state
						for (var cssProp in target.interactionAnimation.exit.original) {
							if (target.interactionAnimation.exit.original.hasOwnProperty(cssProp)) {
								addVendorPrefixes(target, cssProp, target.interactionAnimation.exit.original[cssProp]);
							}
						}
						// Flag to avoid triggering new animations while performing one
						target.interactionAnimation.ongoing = true;
						animation._applyTransition(target, target.interactionAnimation.exit);
					}
				} else {
					target.style.visibility = 'hidden';
				}
			}
		};

		this._toggle = function _toggle(elementId) {
			var target = document.getElementById(elementId),
				oldVisibility = getComputedStyle(target).visibility;
			if (oldVisibility == "hidden") {
				this._show(elementId);
			} else {
				this._hide(elementId);
			}
		};

		this._goto = function _goto(sceneId) {
			var scenesById = _.map(course.scenes, function (scene) {
				return scene.id;
			});
			var index = _.indexOf(scenesById, sceneId);
			if (index >= 0) {
				clearTimeout(timeout);
				sceneIndex = index;
				nextSceneID = false;
				// Set video playing to false
				videoPlaying = false;
				looper();
			}
		};
	}

	/**
	 * Calcula as dimensões de objetos como imagens, figuras, etc
	 */
	function calculateGenericDimensions(object) {
		var width, height, left, top, originalWidth, originalHeight;

		height = object.height;
		width = object.width;

		// scaleX e Y
		if (object.scaleX)
			originalWidth = width * object.scaleX;
		if (object.scaleY)
			originalHeight = height * object.scaleY;
		width = originalWidth * globalScale.x;
		height = originalHeight * globalScale.y;

		// left
		if (object.originX == 'center') {
			left = object.left*globalScale.x - (width/2);
		} else {
			left = object.left*globalScale.x;
		}

		// top
		if (object.originY == 'center') {
			top = object.top*globalScale.y - (height/2);
		} else {
			top = object.top*globalScale.y;
		}

		return {
			'height': height,
			'width': width,
			'left': left,
			'top': top
		};
	}

	function addClass(el, cls) {
		var classes = el.getAttribute('class');
		classes += " " + cls;

		el.setAttribute('class', classes);
	}

	function ucfirst(str) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

	function getComputedStyle(element) {
		var computedStyle;
		if (element.computedStyle) {
			computedStyle = element.computedStyle;
		} else {
			computedStyle = global.getComputedStyle(element);
		}
		return computedStyle;
	}

	function removeVideo (cb) {
		if (YTPlayer) {
			YTPlayer.destroy();
			YTPlayer = null;
			cb();
		} else {
			videoElement.style.visibility = 'hidden';
			videoElement.pause();
			setTimeout(function() {
				videoElement.style.top = 0;
				videoElement.style.left = 0;
				if (isWebOS) {
					videoElement.setAttribute('width', global.innerWidth);
					videoElement.setAttribute('height', global.innerHeight);
				}
				if (typeof cb == 'function') {
					cb();
				}
			}, 10);
		}
	}

	/********************
	*	UTILS PLAYER	*
	********************/

	/*
	*	Parse Query String to objects
	*/

	function parseQueryString (queryString) {
		if(typeof(queryString) != 'string'){
			return queryString;
		}

		// TEMP HOTFIX, replace '+' for %20 because of motherf***ng old PHP
		queryString = queryString.replace(/\+/g, '%20');

		if(queryString[0] == '?'){
			queryString = queryString.substring(1, queryString.length);
		}

		var params = {}, queries, temp, i, l;
		queries = queryString.split('&');

		for ( i = 0, l = queries.length; i < l; i++ ) {
			temp = queries[i].split('=');
			params[temp[0]] = temp[1];

			// Check for 4YouSee's old txtVar and extract variables again
			if (temp[0] == 'txtVar') {
				try {
					params.txtVar = decodeURIComponent(temp[1]);
				} catch (e) {
					params.txtVar = temp[1];
				}
				parseTxtVar(temp[1], params);
			}
		}

		return params;
	}
	global.parseQueryString = parseQueryString;

	function parseTxtVar(txtVar, mapObject) {
		mapObject = mapObject || {};
		if (txtVar) {
			txtVar = decodeAll(txtVar);
			var secondaryParams = parseQueryString(txtVar);
			for (var templateVar in secondaryParams) {
				if (secondaryParams.hasOwnProperty(templateVar)) {
					mapObject[templateVar] = secondaryParams[templateVar];
				}
			}
		}

		function decodeAll(txt) {
			if (/%[0-9a-f]{2}/i.test(txt)) {
				// There is an encoded character, decode and try again
				var decoded;
				try {
					return decodeAll(decodeURIComponent(txt));
				} catch (e) {
					return txt;
				}
			} else {
				return txt;
			}
		}
	}

	/*
	*	Add vendor prefixes to CSS tranforms.
	*/

	function addVendorPrefixes (element, transformType, transformParams) {
		var prefixes = ['-webkit-', ''];// '-moz-', '-o-', ''];
		prefixes.forEach(function (prefix) {
			element.style[prefix+transformType] = transformParams;
		});
	}

	function logInScreen() {
		var div = document.getElementById('log');
		for (var i = 0; i < arguments.length; i++) {
			if (typeof arguments[i] === 'object') {
				for (var prop in arguments[i]) {
					if (arguments[i].hasOwnProperty(prop)) {
						logThis(prop, arguments[i][prop]);
					}
				}
			} else {
				logThis('var', arguments[i]);
			}
		}

		function logThis(prop, value) {
			var p = document.createElement('p');
			p.innerHTML = prop + ' : ' + value;
			div.appendChild(p);
		}
	}

	// Debug
	// window.onerror = logInScreen;

	global.stopPlayback = function stopPlayback() {
		clearTimeout(timeout);
	};
})(window);


/**
Fontes:
- http://css-tricks.com/examples/ShapesOfCSS/
- http://css-tricks.com/controlling-css-animations-transitions-javascript/
-

*/

