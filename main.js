var language = brackets.getLocale().substr(0,2);

define(function(require, exports, module) {
     "use strict";
 
    var KeyBindingManager = brackets.getModule("command/KeyBindingManager"),
    EditorManager = brackets.getModule("editor/EditorManager"),
    DocumentManager = brackets.getModule("document/DocumentManager"),
    ExtensionUtils = brackets.getModule("utils/ExtensionUtils");

    var ExtPath = ExtensionUtils.getModulePath(module);
    
    // Extension modules
    var InlineDocsViewer = require("InlineDocsViewer");
 
    
    function inlineProvider(hostEditor, pos) {
        // get editor content
        var currentDoc = DocumentManager.getCurrentDocument().getText();
       
        // get programming language
        var langId = hostEditor.getLanguageForSelection().getId();
        
        // Only provide docs when cursor is in php ("clike") content
        if (langId !== "php" && langId !== "clike" ) {
            return null;
        }
        
        // no multiline selection
        var sel = hostEditor.getSelection();
        if (sel.start.line !== sel.end.line) {
            return null;
        }
        
        // get function name
        var func = get_func_name(currentDoc,sel.start);
		var func_name = func[0];
		var func_class = func[1];
     
		
        // if a function was selected
        if (func_name) {
            // Initialize the Ajax request
            var xhr = new XMLHttpRequest();
            // if the language isn't available => use English
            if (language != "en" && language != "de" && language != "es" && language != "fr") {
             language = "en";   
            }
            // open json file (synchronous) 
			if (!func_class) {
				xhr.open('get', ExtPath+'docs/'+language+'/php.json', false);
			} else {
				xhr.open('get', ExtPath+'docs/'+language+'/classes.json', false);
			}
            // Send the request 
            xhr.send(null);
            
            if(xhr.status === 0){
                // function information is available
                var tags = JSON.parse(xhr.responseText);
                
				if (!func_class) {
					tags = eval('tags.'+func_name);
				} else if (func_class != "new") {
					tags = eval('tags.'+func_class+'.'+func_name);
				} else {
					tags = eval('tags.'+func_name+'.__construct');
				}
                // try userdefined tags
                if (!tags) {
					var func = new Object();
					func.name = func_name;
					tags = get_userdefined_tags(currentDoc,func);
					var url = null;
                } else {
                    var url = func_name;
                }
                
                // if the function exists
                if (tags) {
                if (tags.s != "" || tags.p) {
                    if (!summary) {
						var summary = tags.s;
					}
                    // check if function has parameters
                    if (tags.p) { 
                        var parameters = tags.p;
                    } else {
                        var parameters = eval("[{}]");   
                    }
                    tags.r = tags.r ? '<b>Return</b><br>' + tags.r : ''; // empty string if tags.r isn't defined

                    var result = new $.Deferred();
                    var inlineWidget = new InlineDocsViewer(func_name,{SUMMARY:summary, SYNTAX: tags.y, RETURN: tags.r, URL:url, VALUES:parameters});
                    inlineWidget.load(hostEditor);
                    result.resolve(inlineWidget);
                    return result.promise();
                }
                }
            }
        } 
        return null;
    }
    
    function get_func_name(content,pos) {
        // get the content of each line
        var lines = content.split("\n");
        // get the content of the selected line
        var line = lines[pos.line];
        // get string after current position
        var line_after = line.substr(pos.ch);
        // get string before current position
        var line_begin = line.substr(0,pos.ch);
        // reverse the string before current position
        var line_begin_rev = reverse_str(line_begin);
        
        
        // characters which can be part of a function name
        var function_chars = '0123456789abcdefghijklmnopqrstuvwxyz_';
        
        var e = 0;
        while (function_chars.indexOf(line_after.substr(e,1).toLowerCase()) !== -1 && e < line_after.length) {
            e++;
        }
        
        var b = 0;
        while (function_chars.indexOf(line_begin_rev.substr(b,1).toLowerCase()) !== -1 && b < line_begin_rev.length) {
            b++;
        }

        // characters which can't be directly before the function_name
        var no_function_chars = '0123456789$';
        if (no_function_chars.indexOf(line_begin_rev.substr(b,1)) === -1 || b == line_begin_rev.length) {
            var func_name = line.substr(pos.ch-b,b+e);
		
			// if func name starts with a letter
			if (func_name.charAt(0).match(/[a-zA-Z]/)) {
				var func_class = null;
				if (line_begin_rev.substr(b,2) == '>-') {
					var class_pos = line_begin_rev.indexOf('$',b);
					// func_class (without $)
					if (class_pos != -1) {
						var varClass = line.substr(pos.ch-class_pos,class_pos-b-2);
						func_class = getClass(content,varClass);
					}
				} else {
					if (line_begin_rev.substr(b+1,3) == 'wen') {
						func_class = "new";	
					}
				}
            	return [func_name,func_class];
			} else {
				return null;
			}
        }
 
        return null;
    }
    
	
	 
    /**
        get the type of class 
        @param content  {string} content of document
        @param variable {string} name of the variable
        @return type of the variable: Classname
    */
    function getClass (content, variable) {
        // get the declaration for this variable 
        // can be a ',' between two declarations
        var regex = new RegExp('\\$' + variable + '\\s*?=\\s*?new','');
        var match = regex.exec(content);
     
        if (match) {
            var pos = match.index;
            // length of the match
            var match_len = match[0].length;
        } else {
            // if the declaration is not available in this content
            return null;   
        }
		
		// get Class Value
		var value = content.substr(pos+match_len,content.substr(pos+match_len).search(/[(;,]/));
        value = value.trim();
		return value;
	}
    
     /**
    * user defined functions can documentated with JavaDoc
    * @param content    {string}    content of document
    * @param func       {object}       function (includs func.name)
    * @return tags object
    */
    function get_userdefined_tags(content,func) {
        var tags = new Object();
        var regex = /\/\*\*(?:[ \t]*?)\n(?:[\s\S]*?)\*\/(?:[ \t]*?)\n(?:[ \t]*?)(.*?)(\n|$)/gmi; // global,multiline,insensitive

        var matches = null;
        while (matches = regex.exec(content)) {
            // matches[0] = all
            // macthes[1] = function '''function_name'''(
            // get the function name
			// start_pos
			var start_func_name = matches[1].trim().indexOf("function ")+9;
			if (start_func_name > 8) { // indexOf != -1
				var match_func = matches[1].trim().substr(start_func_name);
				var end_func_name = match_func.search(/(\(|$)/);
				var match_func = match_func.substring(0,end_func_name);
			} else {
				match_func === "";	
			}
            if (match_func === func.name) {
                var lines = matches[0].split('\n');
        
                // until the first @ it's description 
                // afterwards the description can't start again
                var canbe_des = true; // can be description
                var params = [];
                // first line is /**, and last two ones are */ \n function
                for (var i = 1; i < lines.length-2; i++) {
                    lines[i] = lines[i].trim(); // trim each line
                    lines[i] = lines[i].replace(/^\*/,'').trim(); // delete * at the beginning and trim line again
                    
                    // no @ => decription part 
                    if (lines[i].substr(0,1) !== '@' && canbe_des) {
                        if (tags.s && lines[i]) {
                            tags.s += ' ' + lines[i]; // add to summary part
                        } else if (!tags.s) {
                            tags.s = lines[i];
                        }
                    }
                    tags.y = ''; // syntax is empty for this
                    
					if (lines[i].substr(0,6) === '@param' || lines[i].substr(0,7) === '@return') {
						canbe_des = false; // description tag closed
					}
					
                    // get params
                    if (lines[i].substr(0,6) === '@param') {
                        var param_parts = lines[i].split(/(?:\s+)/);
                        var param_parts_length = param_parts.length;
                        // 0 = @param, 1 = title, 2-... = description
						// 1 can be the type (not starting with a $) => 2 is the title (phpDoc)
                        // 2 can be the type (inside {}) (JavaDoc)
						if (param_parts[1].substr(0,1) !== '$') {
							// type is part of the title
							if (param_parts_length > 2 && param_parts[2].substr(0,1) == '$') {
                            	var param_title = param_parts[2] + ' {' + param_parts[1] + '}';
								var description = param_parts[3];
								var j_start = 4;
							} else {
								var param_title = "$"+param_parts[1];
								var description = param_parts[2];
								var j_start = 3;
							}                            	
						} else { // maybe JavaDoc
							if (param_parts_length > 2 && param_parts[2].substr(0,1) == '{' && param_parts[2].substr(-1) == '}') {
								// type is part of the title
								var param_title = param_parts[1] + ' ' + param_parts[2]; 
								var description = param_parts[3];
								var j_start = 4;
							} else {
								var param_title = param_parts[1]; 
								var description = param_parts[2];
								var j_start = 3;
							}
						}
                        for (var j = j_start; j < param_parts_length; j++) {
                            description += ' ' + param_parts[j];
                        }
                        params.push({'t':param_title,'d':description});
                    }
                    if (lines[i].substr(0,7) === '@return') {
                        tags.r = lines[i].substr(7).trim(); // delete @return and trim
                    }
                }
                tags.p = params;
                return tags;
            }
         }
        return null;   
    }
    
    // reverse a string
    function reverse_str(s){
        return s.split("").reverse().join("");
    }
    


    
    EditorManager.registerInlineDocsProvider(inlineProvider); 
});