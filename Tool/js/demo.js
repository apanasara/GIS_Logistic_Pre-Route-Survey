var iconObject = L.icon({
    iconUrl: './img/marker-icon.png',
    shadowSize: [50, 64],
    shadowAnchor: [4, 62],
    iconAnchor: [12, 40]
});

$(document).ready(function (e) {
    jQuery.support.cors = true;

    $(".tab-content").css("display", "none");
    $(".tabs-menu a").click(function (event) {
        // event.preventDefault();
        showTab($(this));
    });

    function showTab(thisDiv) {
        thisDiv.parent().addClass("current");
        thisDiv.parent().siblings().removeClass("current");
        var tab = thisDiv.attr("href");
        $(".tab-content").not(tab).css("display", "none");
        $(tab).fadeIn();

        // a bit hackish to refresh the map
        routingMap.invalidateSize(false);
        vrpMap.invalidateSize(false);
        geocodingMap.invalidateSize(false);
        isochroneMap.invalidateSize(false);
        mapMatchingMap.invalidateSize(false);
    }

    var host;// = "http://localhost:9000/api/1";

    //
    // Sign-up for free and get your own key: https://graphhopper.com/#directions-api
    //
    var defaultKey = "c9b2b65d-be3d-4d96-b19c-48365a066ae3";
    var profile = "car";

    /*
     * "truck" vehicle-profile type is availabe in paid API only
     * Truck like a MAN or Mercedes-Benz Actros
     * height=3.7m, width=2.6+0.5m, length=12m, weight=13000 + 13000 kg, hgv=yes, 3 Axes
     * */

    // create a routing client to fetch real routes, elevation.true is only supported for vehicle bike or foot
    var ghRouting = new GraphHopper.Routing({ key: defaultKey, host: host, vehicle: profile, elevation: false });
    var ghGeocoding = new GraphHopper.Geocoding({
        key: defaultKey,
        host: host,
        limit: 8,
        locale: "en" /* currently fr, en, de and it are explicitely supported */
    });
    var ghMatrix = new GraphHopper.Matrix({ key: defaultKey, host: host, vehicle: profile });
    var ghOptimization = new GraphHopper.Optimization({ key: defaultKey, host: host, profile: profile });
    var ghIsochrone = new GraphHopper.Isochrone({ key: defaultKey, host: host, vehicle: profile });
    var ghMapMatching = new GraphHopper.MapMatching({ key: defaultKey, host: host, vehicle: profile });

    //    if (location.protocol === "file:") {
    //        ghOptimization.host = 'http://localhost:9000/api/1';
    //        ghOptimization.basePath = '/vrp';
    //    }

    var overwriteExistingKey = function () {
        var key = $("#custom_key_input").val();
        if (key && key !== defaultKey) {
            $("#custom_key_enabled").show();

            ghRouting.key = key;
            ghMatrix.key = key;
            ghGeocoding.key = key;
            ghOptimization.key = key;
            ghIsochrone.key = key;
            ghMapMatching.key = key;
        } else {
            $("#custom_key_enabled").hide();
        }
    };
    overwriteExistingKey();
    $("#custom_key_button").click(overwriteExistingKey);

    var routingMap = createMap('routing-map');
    setupRoutingAPI(routingMap, ghRouting);

    var vrpMap = createMap('vrp-map');
    setupRouteOptimizationAPI(vrpMap, ghOptimization, ghRouting);

    var geocodingMap = createMap('geocoding-map');
    setupGeocodingAPI(geocodingMap, ghGeocoding);

    setupMatrixAPI(ghMatrix);

    var isochroneMap = createMap('isochrone-map');
    setupIsochrone(isochroneMap, ghIsochrone);

    var mapMatchingMap = createMap('map-matching-map');
    setupMapMatching(mapMatchingMap, ghMapMatching);

    var tmpTab = window.location.hash;
    if (!tmpTab)
        tmpTab = "#routing";

    showTab($(".tabs-menu li > a[href='" + tmpTab + "']"));
});

function setupRoutingAPI(map, ghRouting) {
    map.setView([22.310696, 73.192635], 12);

    var instructionsDiv = $("#instructions");
    map.on('click', function (e) {
        //if (ghRouting.points.length = 1){document.getElementById("routing-error").innerHTML="";}

        if (ghRouting.points.length > 1) {
            ghRouting.clearPoints();
            routingLayer.clearLayers();
        }

        L.marker(e.latlng, { icon: iconObject }).addTo(routingLayer);
        ghRouting.addPoint(new GHInput(e.latlng.lat, e.latlng.lng));
        if (ghRouting.points.length > 1) {
            // ******************
            //  Calculate route! 
            // ******************
            ghRouting.doRequest()
                .then(function (json) {
                    var path = json.paths[0];

                    routingLayer.addData({
                        "type": "Feature",
                        "geometry": path.points
                    });
                    var outHtml = "Distance : " + Math.round(path.distance / 1000) + " km";
                    outHtml += "<br/>Duration : " + DHMConversion(path.time / 1000);
                    $("#routing-response").html(outHtml);

                    if (path.bbox) {
                        var minLon = path.bbox[0];
                        var minLat = path.bbox[1];
                        var maxLon = path.bbox[2];
                        var maxLat = path.bbox[3];
                        var tmpB = new L.LatLngBounds(new L.LatLng(minLat, minLon), new L.LatLng(maxLat, maxLon));
                        map.fitBounds(tmpB);
                    }

                    var qry = "data=[out:json];q1[q2](around:1,";

                    function Transform_Coordinates(lon_lat) {
                        var lat_lon = [lon_lat[1],lon_lat[0]].join(",");
                        return lat_lon;
                      }

                      qry = qry + path.points.coordinates.map(Transform_Coordinates)+ ");(._;>;);out geom;";

                      var qry_type = [
                        ["bridge","bridge",0],
                        ["powerline","power=line",0],
                        ["tunnel","tunnel=yes",0],
                        ["waterway","waterway",0],
                        ["railway","railway",0],
                        ["railcrossing","railway=level_crossing",1],
                        ["tollbooth","barrier=toll_booth",1]
                    ];

                    document.getElementById("server-response").innerHTML="";
                    document.getElementById("GISForm").innerHTML = "";
                    var res="";
                    for (let i = 0; i < qry_type.length; i++) {
                        var isNode = qry_type[i][2];
                        var OverpassQuery = qry.replace("q1",(isNode == 1) ?"node":"way");
                        OverpassQuery = OverpassQuery.replace("q2",qry_type[i][1]);
                        
                        var url = "https://overpass.kumi.systems/api/interpreter";
                        var ret = postAsync(url, OverpassQuery);
                        if (ret.match(/^XHR error/)) { console.log(ret); return; }
                        

                        if ((isNode == 1) ? ret.indexOf("node")>=0 : ret.indexOf("way")>=0)
                        {
                            var srch = "Feature";
                            geoJSN = JSON.stringify(osmtogeojson(JSON.parse(ret)));
                            res=res+
                                "<input id=\""+ qry_type[i][0]+"-input\" class=\"details\" type=\"checkbox\" />" +
                                "<a><label for=\""+ qry_type[i][0]+"-input\">"+ qry_type[i][0]+" : "+ (((geoJSN.match(/Feature/g)||[]).length)-1) +"</label></a>"+ 
                                "<section id=\""+ qry_type[i][0]+"\">"+geoJSN+"</section>";
                            console.log(qry_type[i][0]+ " found...");
                        }
                        else
                        {
                            if (qry_type[i][0]=="railway"){i++;}//if skipping rail_crossing
                            console.log(qry_type[i][0]+ " NOT found...");
                        }
                    }

                        map.createPane('other');
                        document.getElementById("GISForm").innerHTML = "";
                        document.getElementById("server-response").innerHTML=res;
                        let draw = ["railway", "waterway", "tunnel", "tollbooth", "railcrossing", "bridge", "powerline"].map(function (item) {
                            if (document.getElementById(item) != undefined) {
                                var draw_data = JSON.parse(document.getElementById(item).innerHTML);
                                map.createPane(item);
                                Leaflet_Overpass(map, draw_data);
                                document.getElementById("GISForm").innerHTML += "<label><input id=\"" + item + "\" type=\"checkbox\" onchange=\"layer_display(this)\" checked/>" + item + "</label>";
                            }
                        });
                        
                      
                    
                    /*//calling Java-servlet
                    var url = //"/GIS_Trial/GISForm";
                    var var_str = "path=" + JSON.stringify(path.points.coordinates);
                    var ret = postAsync(url, var_str);
                    if (ret.match(/^XHR error/)) { console.log(ret); return; }
                    document.getElementById("server-response").innerHTML = ret;
                    map.createPane('other');
                    document.getElementById("GISForm").innerHTML = "";
                    let draw = ["railway", "waterway", "tunnel", "tollbooth", "railcrossing", "bridge", "powerline"].map(function (item) {
                        if (document.getElementById(item) != undefined) {
                            var draw_data = JSON.parse(document.getElementById(item).innerHTML);
                            map.createPane(item);
                            Leaflet_Overpass(map, draw_data);
                            document.getElementById("GISForm").innerHTML += "<label><input id=\"" + item + "\" type=\"checkbox\" onchange=\"layer_display(this)\" checked/>" + item + "</label>";
                        }
                    });*/

                    //populating instructions
                    instructionsDiv.empty();
                    if (path.instructions) {
                        var allPoints = path.points.coordinates;
                        var listUL = $("<ol>");
                        instructionsDiv.append(listUL);

                        var ipane = map.createPane('instruction');

                        for (var idx in path.instructions) {
                            var instr = path.instructions[idx];

                            // use 'interval' to find the geometry (list of points) until the next instruction
                            var instruction_points = allPoints.slice(instr.interval[0], instr.interval[1]);

                            // use 'sign' to display e.g. equally named images

                            $("<li>" + instr.text + " <small>(" + ghRouting.getTurnText(instr.sign) + ")</small>"
                                + " for " + instr.distance + "m and " + Math.round(instr.time / 1000) + "sec"
                                + ", geometry points:" + instruction_points.length + "</li>").appendTo(listUL);

                            //[longitude, latitude]-order: OpenLayers, MapboxGL, KML, GeoJSON, PostGIS, MongoDB, MySQL, GeoServer
                            //[latitude, longitude]-order: Leaflet, Google Maps API, ArangoDB

                            if ([-3, -2, 2, 3, 6].includes(instr.sign)) {
                                var mrkr = L.marker([instruction_points[0][1], instruction_points[0][0]], {
                                    icon: new L.DivIcon
                                        ({
                                            className: 'instruction',
                                            iconSize: [30, 30],
                                            iconAnchor: [0, 0],
                                            html: '<div class="i' + instr.sign + '"></div>',
                                        })
                                }).addTo(map).bindPopup("<b>" + (instr.distance / 1000).toFixed(2) + " km</b> : " + ghRouting.getTurnText(instr.sign));
                            }
                        }
                    }

                })
                .catch(function (err) {
                    var str = "An error occured: " + err.message;
                    $("#routing-response").text(str);
                })
        }
    })// map click function over

    var instructionsHeader = $("#instructions-header");
    instructionsHeader.click(function () {
        instructionsDiv.toggle();
    });

    var routingLayer = L.geoJson().addTo(map);
    routingLayer.options = {
        style: { color: "#00cc33", "weight": 5, "opacity": 0.6 }
    };


}

function setupRouteOptimizationAPI(map, ghOptimization, ghRouting) {
    map.setView([51.505, -0.09], 13);

    L.NumberedDivIcon = L.Icon.extend({
        options: {
            iconUrl: './img/marker-icon.png',
            number: '',
            shadowUrl: null,
            iconSize: new L.Point(25, 41),
            iconAnchor: new L.Point(13, 41),
            popupAnchor: new L.Point(0, -33),
            className: 'leaflet-div-icon'
        },
        createIcon: function () {
            var div = document.createElement('div');
            var img = this._createImg(this.options['iconUrl']);
            var numdiv = document.createElement('div');
            numdiv.setAttribute("class", "number");
            numdiv.innerHTML = this.options['number'] || '';
            div.appendChild(img);
            div.appendChild(numdiv);
            this._setIconStyles(div, 'icon');
            return div;
        },
        // you could change this to add a shadow like in the normal marker if you really wanted
        createShadow: function () {
            return null;
        }
    });

    var addPointToMap = function (lat, lng, index) {
        index = parseInt(index);
        if (index === 0) {
            new L.Marker([lat, lng], {
                icon: new L.NumberedDivIcon({ iconUrl: './img/marker-icon-green.png', number: '1' }),
                bounceOnAdd: true,
                bounceOnAddOptions: { duration: 800, height: 200 }
            }).addTo(routingLayer);
        } else {
            new L.Marker([lat, lng], {
                icon: new L.NumberedDivIcon({ number: '' + (index + 1) }),
                bounceOnAdd: true,
                bounceOnAddOptions: { duration: 800, height: 200 },
            }).addTo(routingLayer);
        }
    };

    map.on('click', function (e) {
        addPointToMap(e.latlng.lat, e.latlng.lng, ghOptimization.points.length);
        ghOptimization.addPoint(new GHInput(e.latlng.lat, e.latlng.lng));
    });

    var routingLayer = L.geoJson().addTo(map);
    routingLayer.options.style = function (feature) {
        return feature.properties && feature.properties.style;
    };

    var clearMap = function () {
        ghOptimization.clear();
        routingLayer.clearLayers();
        ghRouting.clearPoints();
        $("#vrp-response").empty();
        $("#vrp-error").empty();
    };

    var createSignupSteps = function () {
        return "<div style='color:black'>To test this example <br/>"
            + "1. <a href='https://graphhopper.com/#directions-api'>sign up for free</a>,<br/>"
            + "2. log in and request a free standard package then <br/>"
            + "3. copy the API key to the text field in the upper right corner<div>";
    };

    var getRouteStyle = function (routeIndex) {
        var routeStyle;
        if (routeIndex === 3) {
            routeStyle = { color: "cyan" };
        } else if (routeIndex === 2) {
            routeStyle = { color: "black" };
        } else if (routeIndex === 1) {
            routeStyle = { color: "green" };
        } else {
            routeStyle = { color: "blue" };
        }

        routeStyle.weight = 5;
        routeStyle.opacity = 1;
        return routeStyle;
    };

    var createGHCallback = function (routeStyle) {
        return function (json) {
            for (var pathIndex = 0; pathIndex < json.paths.length; pathIndex++) {
                var path = json.paths[pathIndex];
                routingLayer.addData({
                    "type": "Feature",
                    "geometry": path.points,
                    "properties": {
                        style: routeStyle
                    }
                });
            }
        };
    };

    var optimizeError = function (err) {
        $("#vrp-response").text(" ");

        if (err.message.indexOf("Too many locations") >= 0) {
            $("#vrp-error").empty();
            $("#vrp-error").append(createSignupSteps());
        } else {
            $("#vrp-error").text("An error occured: " + err.message);
        }
        console.error(err);
    };

    var optimizeResponse = function (json) {
        var sol = json.solution;
        if (!sol)
            return;

        $("#vrp-response").text("Solution found for " + sol.routes.length + " vehicle(s)! "
            + "Distance: " + Math.floor(sol.distance / 1000) + "km "
            + ", time: " + Math.floor(sol.time / 60) + "min "
            + ", costs: " + sol.costs);

        var no_unassigned = sol.unassigned.services.length + sol.unassigned.shipments.length;
        if (no_unassigned > 0)
            $("#vrp-error").append("<br/>unassigned jobs: " + no_unassigned);

        routingLayer.clearLayers();
        for (var routeIndex = 0; routeIndex < sol.routes.length; routeIndex++) {
            var route = sol.routes[routeIndex];

            // fetch real routes from graphhopper
            ghRouting.clearPoints();
            var firstAdd;
            for (var actIndex = 0; actIndex < route.activities.length; actIndex++) {
                var add = route.activities[actIndex].address;
                ghRouting.addPoint(new GHInput(add.lat, add.lon));

                if (!eqAddress(firstAdd, add))
                    addPointToMap(add.lat, add.lon, actIndex);

                if (actIndex === 0)
                    firstAdd = add;
            }

            var ghCallback = createGHCallback(getRouteStyle(routeIndex));

            ghRouting.doRequest({ instructions: false })
                .then(ghCallback)
                .catch(function (err) {
                    var str = "An error for the routing occurred: " + err.message;
                    $("#vrp-error").text(str);
                });
        }
    };

    var eqAddress = function (add1, add2) {
        return add1 && add2
            && Math.floor(add1.lat * 1000000) === Math.floor(add2.lat * 1000000)
            && Math.floor(add1.lon * 1000000) === Math.floor(add2.lon * 1000000);
    };

    var optimizeRoute = function () {
        if (ghOptimization.points.length < 3) {
            $("#vrp-response").text("At least 3 points required but was: " + ghOptimization.points.length);
            return;
        }
        $("#vrp-response").text("Calculating ...");
        ghOptimization.doVRPRequest($("#optimize_vehicles").val())
            .then(optimizeResponse)
            .catch(optimizeError);
    };

    $("#vrp_clear_button").click(clearMap);

    // Increase version if one of the examples change, see #2
    var exampleVersion = 2;

    $("#set_example_vrp").click(function () {
        $.getJSON("route-optimization-examples/vrp_lonlat_new.json?v=" + exampleVersion, function (jsonData) {

            clearMap();
            map.setView([51, 10], 6);
            $("#vrp-response").text("Calculating ...");
            ghOptimization.doRequest(jsonData)
                .then(optimizeResponse)
                .catch(optimizeError);
        });
    });

    $("#set_example_tsp").click(function () {
        $.getJSON("route-optimization-examples/tsp_lonlat_new.json?v=" + exampleVersion, function (jsonData) {

            clearMap();
            map.setView([51, 10], 6);
            $("#vrp-response").text("Calculating ...");
            ghOptimization.doRequest(jsonData)
                .then(optimizeResponse)
                .catch(optimizeError);
        });
    });

    $("#set_example_tsp2").click(function () {
        $.getJSON("route-optimization-examples/tsp_lonlat_end.json?v=" + exampleVersion, function (jsonData) {

            clearMap();
            map.setView([51, 10], 6);
            $("#vrp-response").text("Calculating ...");
            ghOptimization.doRequest(jsonData)
                .then(optimizeResponse)
                .catch(optimizeError);
        });
    });

    $("#set_example_us_tour").click(function () {
        $.getJSON("route-optimization-examples/american_road_trip.json?v=" + exampleVersion, function (jsonData) {

            clearMap();
            map.setView([38.754083, -101.074219], 4);
            $("#vrp-response").text("Calculating ...");
            ghOptimization.doRequest(jsonData)
                .then(optimizeResponse)
                .catch(optimizeError);
        });
    });

    $("#set_example_uk_tour").click(function () {
        $.getJSON("route-optimization-examples/uk50.json?v=" + exampleVersion, function (jsonData) {

            clearMap();
            map.setView([54.136696, -4.592285], 6);
            $("#vrp-response").text("Calculating ...");
            ghOptimization.doRequest(jsonData)
                .then(optimizeResponse)
                .catch(optimizeError);
        });
    });

    $("#optimize_button").click(optimizeRoute);
}

function setupGeocodingAPI(map, ghGeocoding) {
    //  Find address    
    map.setView([51.505, -0.09], 13);
    var iconObject = L.icon({
        iconUrl: './img/marker-icon.png',
        shadowSize: [50, 64],
        shadowAnchor: [4, 62],
        iconAnchor: [12, 40]
    });
    var geocodingLayer = L.geoJson().addTo(map);
    geocodingLayer.options = {
        style: { color: "#00cc33", "weight": 5, "opacity": 0.6 }
    };

    L.NumberedDivIcon = L.Icon.extend({
        options: {
            iconUrl: './img/marker-icon.png',
            iconSize: new L.Point(25, 41),
            iconAnchor: new L.Point(13, 41),
            popupAnchor: new L.Point(0, -33),
            className: 'leaflet-div-icon'
        },
        createIcon: function () {
            var div = document.createElement('div');
            var img = this._createImg(this.options['iconUrl']);
            var numdiv = document.createElement('div');
            numdiv.setAttribute("class", "number");
            numdiv.innerHTML = this.options['number'] || '';
            div.appendChild(img);
            div.appendChild(numdiv);
            this._setIconStyles(div, 'icon');
            return div;
        }
    });

    var clearGeocoding = function () {
        $("#geocoding-results").empty();
        $("#geocoding-error").empty();
        $("#geocoding-response").empty();
        geocodingLayer.clearLayers();
    };

    var mysubmit = function () {
        clearGeocoding();

        ghGeocoding.doRequest({ query: textField.val() })
            .then(function (json) {
                var listUL = $("<ol>");
                $("#geocoding-response").append("Locale:" + ghGeocoding.locale + "<br/>").append(listUL);
                var minLon, minLat, maxLon, maxLat;
                var counter = 0;
                for (var hitIdx in json.hits) {
                    counter++;
                    var hit = json.hits[hitIdx];

                    var str = counter + ". " + dataToText(hit);
                    $("<div>" + str + "</div>").appendTo(listUL);
                    new L.Marker(hit.point, {
                        icon: new L.NumberedDivIcon({ iconUrl: './img/marker-icon-green.png', number: '' + counter })
                    }).bindPopup("<div>" + str + "</div>").addTo(geocodingLayer);

                    if (!minLat || minLat > hit.point.lat)
                        minLat = hit.point.lat;
                    if (!minLon || minLon > hit.point.lng)
                        minLon = hit.point.lng;

                    if (!maxLat || maxLat < hit.point.lat)
                        maxLat = hit.point.lat;
                    if (!maxLon || maxLon < hit.point.lng)
                        maxLon = hit.point.lng;
                }

                if (minLat) {
                    var tmpB = new L.LatLngBounds(new L.LatLng(minLat, minLon), new L.LatLng(maxLat, maxLon));
                    map.fitBounds(tmpB);
                }
            })
            .catch(function (err) {
                $("#geocoding-error").text("An error occured: " + err.message);
            });
    };

    // reverse geocoding
    var iconObject = L.icon({
        iconUrl: './img/marker-icon.png',
        shadowSize: [50, 64],
        shadowAnchor: [4, 62],
        iconAnchor: [12, 40],
        popupAnchor: new L.Point(0, -33),
    });
    map.on('click', function (e) {
        clearGeocoding();

        ghGeocoding.doRequest({ point: e.latlng.lat + "," + e.latlng.lng })
            .then(function (json) {
                var counter = 0;
                for (var hitIdx in json.hits) {
                    counter++;
                    var hit = json.hits[hitIdx];
                    var str = counter + ". " + dataToText(hit);
                    L.marker(hit.point, { icon: iconObject }).addTo(geocodingLayer).bindPopup(str).openPopup();

                    // only show first result for now
                    break;
                }
            })
            .catch(function (err) {
                $("#geocoding-error").text("An error occured: " + err.message);
            });
    });

    var textField = $("#geocoding_text_field");
    textField.keypress(function (e) {
        if (e.which === 13) {
            mysubmit();
            return false;
        }
    });

    $("#geocoding_search_button").click(mysubmit);

    function dataToText(data) {
        var text = "";
        if (data.name)
            text += data.name;

        if (data.postcode)
            text = insComma(text, data.postcode);

        // make sure name won't be duplicated
        if (data.city && text.indexOf(data.city) < 0)
            text = insComma(text, data.city);

        if (data.country && text.indexOf(data.country) < 0)
            text = insComma(text, data.country);
        return text;
    }

    function insComma(textA, textB) {
        if (textA.length > 0)
            return textA + ", " + textB;
        return textB;
    }
}

function setupMatrixAPI(ghMatrix) {
    $('#matrix_search_button').click(function () {

        // possible out_array options are: weights, distances, times, paths
        ghMatrix.addOutArray("distances");
        ghMatrix.addOutArray("times");

        ghMatrix.clearPoints();
        $('.point').each(function (idx, div) {
            // parse the input strings and adds it as from_point and to_point
            ghMatrix.addPoint(new GHInput($(div).val()));

            // To create an NxM matrix you can simply use the other methods e.g.
            // ghm.addFromPoint(new GHInput(someCoordinateString))
            // or
            // ghm.addToPoint(new GHInput(someCoordinateString))
        });

        $("#matrix-error").empty();
        $("#matrix-response").empty();

        ghMatrix.doRequest()
            .then(function (json) {
                var outHtml = "Distances in meters: <br/>" + ghMatrix.toHtmlTable(json.distances);
                outHtml += "<br/><br/>Times in seconds: <br/>" + ghMatrix.toHtmlTable(json.times);
                $("#matrix-response").html(outHtml);
            })
            .catch(function (err) {
                var str = "An error occured: " + err.message;
                $("#matrix-error").text(str);
            });

        return false;
    });
}

function setupIsochrone(map, ghIsochrone) {
    map.setView([37.44, -122.16], 12);
    var isochroneLayer;
    var inprogress = false;

    map.on('click', function (e) {
        var pointStr = e.latlng.lat + "," + e.latlng.lng;

        if (!inprogress) {
            inprogress = true;
            $('#isochrone-response').text("Calculating ...");
            ghIsochrone.doRequest({ point: pointStr, buckets: 2 })
                .then(function (json) {
                    if (isochroneLayer)
                        isochroneLayer.clearLayers();

                    isochroneLayer = L.geoJson(json.polygons, {
                        style: function (feature) {
                            var num = feature.properties.bucket;
                            var color = (num % 2 === 0) ? "#00cc33" : "blue";
                            return { color: color, "weight": num + 2, "opacity": 0.6 };
                        }
                    });

                    map.addLayer(isochroneLayer);

                    $('#isochrone-response').text("Calculation done");
                    inprogress = false;
                })
                .catch(function (err) {
                    $('#isochrone-response').text("An error occured: " + err.message);
                })
                ;
        } else {
            $('#isochrone-response').text("Please wait. Calculation in progress ...");
        }
    });
}

function createMap(divId) {
    var osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    var omniscale = L.tileLayer.wms('https://maps.omniscale.net/v1/ghexamples-3646a190/tile', {
        layers: 'osm',
        attribution: osmAttr + ', &copy; <a href="http://maps.omniscale.com/">Omniscale</a>'
    });

    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: osmAttr
    });

    var map = L.map(divId, { layers: [omniscale] });
    L.control.layers({
        "Omniscale": omniscale,
        "OpenStreetMap": osm
    }).addTo(map);
    return map;
}

function setupMapMatching(map, mmClient) {
    map.setView([50.9, 13.4], 9);
    var routeLayer = L.geoJson().addTo(map);
    routeLayer.options = {
        // use style provided by the 'properties' entry of the geojson added by addDataToRoutingLayer
        style: function (feature) {
            return feature.properties && feature.properties.style;
        }
    };

    function mybind(key, url, vehicle) {
        $("#" + key).click(function (event) {
            $("#" + key).prop('disabled', true);
            $("#map-matching-response").text("downloading file ...");
            $.get(url, function (content) {
                var dom = (new DOMParser()).parseFromString(content, 'text/xml');
                var pathOriginal = toGeoJSON.gpx(dom);
                routeLayer.clearLayers();
                pathOriginal.features[0].properties = { style: { color: "black", weight: 2, opacity: 0.9 } };
                routeLayer.addData(pathOriginal);
                $("#map-matching-response").text("send file ...");
                $("#map-matching-error").text("");
                if (!vehicle)
                    vehicle = "car";
                mmClient.vehicle = vehicle;
                mmClient.doRequest(content)
                    .then(function (json) {
                        $("#map-matching-response").text("calculated map matching");
                        var matchedPath = json.paths[0];
                        var geojsonFeature = {
                            type: "Feature",
                            geometry: matchedPath.points,
                            properties: { style: { color: "#00cc33", weight: 6, opacity: 0.4 } }
                        };
                        routeLayer.addData(geojsonFeature);
                        if (matchedPath.bbox) {
                            var minLon = matchedPath.bbox[0];
                            var minLat = matchedPath.bbox[1];
                            var maxLon = matchedPath.bbox[2];
                            var maxLat = matchedPath.bbox[3];
                            var tmpB = new L.LatLngBounds(new L.LatLng(minLat, minLon), new L.LatLng(maxLat, maxLon));
                            map.fitBounds(tmpB);
                        }
                        $("#" + key).prop('disabled', false);
                    })
                    .catch(function (err) {
                        $("#map-matching-response").text("");
                        $("#map-matching-error").text(err.message);
                        $("#" + key).prop('disabled', false);
                    });//doRequest
            });// get
        });//click
    }

    var host = "https://raw.githubusercontent.com/graphhopper/directions-api-js-client/master/map-matching-examples";
    mybind("bike_example1", host + "/bike.gpx", "bike");
    mybind("car_example1", host + "/car.gpx", "car");
    mybind("truck_example1", host + "/truck.gpx", "truck");
}

function downloadObjectAsJson(exportObj, exportName) {
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
    var downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", exportName + ".json");
    //document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    //downloadAnchorNode.remove();
}

function postAsync(url2get, sendstr) {
    var req;
    if (window.XMLHttpRequest) {
        req = new XMLHttpRequest();
    } else if (window.ActiveXObject) {
        req = new ActiveXObject("Microsoft.XMLHTTP");
    }
    if (req != undefined) {
        req.overrideMimeType("application/json;charset=UTF-8"); // if request result is JSON
        try {
            req.open("POST", url2get, false); // 3rd param is whether "async"
        }
        catch (err) {
            alert("couldnt complete request. Is JS enabled for that domain?\\n\\n" + err.message);
            return false;
        }
        req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");//"application/json;charset=UTF-8");
        req.send(sendstr); // param string only used for POST

        if (req.readyState == 4) { // only if req is "loaded"
            if (req.status == 200)  // only if "OK"
            { return req.responseText; }
            else { return "XHR error: " + req.status + " " + req.statusText; }
        }
    }
    alert("req for getAsync is undefined");
}

function sendMyComment() {

    var oForm = document.forms['JavascriptForm'];
    var path = document.createElement("input");

    path.setAttribute("type", "hidden");
    path("name", "path");
    path("id", "cordinate_placeholder");
    path("value", path.points.coordinates);

    oForm.appendChild(path);

    document.forms['JavascriptForm'].submit();
}


function DHMConversion(seconds) {
    var days = Math.floor(seconds / (3600 * 24));
    seconds -= days * 3600 * 24;
    var hrs = Math.floor(seconds / 3600);
    seconds -= hrs * 3600;
    var mnts = Math.floor(seconds / 60);
    seconds -= mnts * 60;

    return days + " days " + hrs + " hr " + mnts + " min ";
}

function Leaflet_Overpass(map, osmData) {


    /*deleting unwanted_blank nodes
    var obj=resultAsGeojson.features;
    var i = resultAsGeojson.features.length;
    while (i--)
    {
        
        if (obj[i].properties.type=="node")
        {
            if (obj[i].properties.tags.railway != 'level_crossing' && obj[i].properties.tags.barrier != 'toll_booth')
            {
                obj.splice(i,1);
            }
        }
    }*/


    var resultLayer = L.geoJson(osmData,
        {
            style: function (feature) { return { pane: getFPane(feature.properties.tags) }; },
            pointToLayer: function (feature, latlng) {
                switch (getFPane(feature.properties.tags)) {
                    case 'tollbooth':
                    case 'railcrossing':
                        return L.marker(latlng, {
                            icon: new L.DivIcon({
                                className: 'divmarker',
                                iconSize: [40, 40],
                                iconAnchor: [20, 50],
                                html: '<div class="' + getFPane(feature.properties.tags) + '"></div>',
                                popupAnchor: [-3, -45]
                            })
                        });
                        break;
                    default: return L.marker(latlng, {
                        icon:
                            new L.Icon({
                                iconUrl: 'mypicture',
                                iconRetinaUrl: 'mypicture',
                                iconSize: [0.00, 0.00],
                                iconAnchor: [0, 0],
                                popupAnchor: [1, -34],
                                shadowSize: [0, 0]
                            })
                    });
                }
            },
            filter: function (feature, layer) {
                var isPolygon = (feature.geometry) && (feature.geometry.type !== undefined) && (feature.geometry.type === "Polygon");
                if (isPolygon) {
                    feature.geometry.type = "Point";
                    var polygonCenter = L.latLngBounds(feature.geometry.coordinates[0]).getCenter();
                    feature.geometry.coordinates = [polygonCenter.lat, polygonCenter.lng];
                }
                return true;
            },
            onEachFeature: function (feature, layer) {
                var entity = new Object();
                entity.name = (feature.properties.tags.name != undefined) ? feature.properties.tags.name : getFPane(feature.properties.tags);
                entity.info = "";
                switch (getFPane(feature.properties.tags)) {
                    case 'waterway':
                        entity.name = feature.properties.tags.waterway;
                        entity.info = (feature.properties.tags.name != undefined) ? "<p>" + feature.properties.tags.name + "</p>" : "";
                        entity.info += (feature.properties.tags.intermittent === 'yes') ? "<p>Intermittent Flow</p>" : "";
                        break;
                    case 'powerline':
                        entity.name = (feature.properties.tags.voltage != undefined) ? (Number(feature.properties.tags.voltage) / 1000 + "kV Line") : getFPane(feature.properties.tags);
                        entity.info = feature.properties.tags.cables + " no of cabels";
                        break;
                    case 'railway':
                        entity.name = (feature.properties.tags.railway != 'rail') ? feature.properties.tags.railway : 'Rail-Way';
                    case 'railcrossing':
                        entity.info = (feature.properties.tags.electrified != undefined && feature.properties.tags.electrified != 'no') ? "<p>Electrified Line</p>" : "";
                        entity.info += (feature.properties.tags.gauge != undefined) ? "<p>Gauge : " + feature.properties.tags.gauge + "</p>" : "";
                        entity.info += (feature.properties.tags.usage != undefined) ? "<p>Usage : " + feature.properties.tags.usage + "</p>" : "";
                        entity.info += (feature.properties.tags.passenger_lines != undefined) ? "<p>No of Lines : " + feature.properties.tags.passenger_lines + "</p>" : "";
                        break;
                    case 'bridge':
                        entity.name = (feature.properties.tags.bridge != 'yes') ? feature.properties.tags.bridge + " Bridge" : (feature.properties.tags.name != undefined) ? feature.properties.tags.name : 'Bridge';
                        break;
                };
                var popupContent = "<h2>" + entity.name + "</h2>" +
                    ((entity.info != "") ? entity.info + "<br/>" : "") +
                    "<a href=\"https://www.openstreetmap.org/" + feature.id + "\">" + feature.properties.type + " : " + feature.properties.id + "</a>";
                /*popupContent += "<table border='1'border-style='dotted'>";
                var myObj = feature.properties.tags;
                for (x in myObj) {
                    popupContent += "<tr><td>" + x + "</td><td>" + myObj[x] + "</td></tr>";
                }
                popupContent += "</table>";*/
                layer.bindPopup(popupContent);
            }
        }).addTo(map);
    return;

    function getFPane(x) {/*sequence metters for waterway, tunnel bridge*/
        return x.power != undefined ? 'powerline' :
            x.waterway != undefined ? 'waterway' :
                x.railway != undefined ? (x.railway == 'level_crossing' ? 'railcrossing' : 'railway') :
                    x.tunnel != undefined ? 'tunnel' :
                        x.bridge != undefined ? 'bridge' :
                            x.barrier != undefined ? 'tollbooth' :
                                'other';
    };

}
function layer_display(element) {
    if (element.id == "tollbooth" || element.id == "railcrossing") {
        document.getElementsByClassName(element.id)[0].style.display = (element.checked ? 'block' : 'none');
    }
    else {
        document.getElementsByClassName("leaflet-" + element.id + "-pane")[0].style.display = (element.checked ? 'block' : 'none');
    }
}