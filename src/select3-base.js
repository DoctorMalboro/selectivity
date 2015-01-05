'use strict';

var $ = require('jquery');

/**
 * Create a new Select3 instance or invoke a method on an instance.
 *
 * @param methodName Optional name of a method to call. If omitted, a Select3 instance is created
 *                   for each element in the set of matched elements. If an element in the set
 *                   already has a Select3 instance, the result is the same as if the setOptions()
 *                   method is called.
 * @param options Optional options object to pass to the given method or the constructor. See the
 *                documentation for the respective methods to see which options they accept. In case
 *                a new instance is being created, the following property is used:
 *                implementation - The implementation to use. Default implementations include
 *                                 'Multiple' and 'Single', but you can add custom implementations
 *                                 to the Implementations map. The default value is 'Single', unless
 *                                 multiple is true in which case it is 'Multiple'.
 *                multiple - Boolean determining whether multiple items may be selected
 *                           (default: false). If true, a MultipleSelect3 instance is created,
 *                           otherwise a SingleSelect3 instance is created.
 *
 * @return If the given method returns a value, this method returns the value of that method
 *         executed on the first element in the set of matched elements.
 */
function select3(methodName, options) {
    /* jshint validthis: true */

    var result;

    this.each(function() {
        var instance = this.select3;

        if (instance) {
            if ($.type(methodName) !== 'string') {
                options = methodName;
                methodName = 'setOptions';
            }

            if ($.type(instance[methodName]) === 'function') {
                if ($.type(result) === 'undefined') {
                    result = instance[methodName].call(instance, options);
                }
            } else {
                throw new Error('Unknown method: ' + methodName);
            }
        } else {
            if ($.type(methodName) === 'string') {
                throw new Error('Cannot call method on element without Select3 instance');
            } else {
                options = $.extend({}, methodName, { element: this });

                var Implementations = Select3.Implementations;
                var Implementation = (options.implementation || (options.multiple ? 'Multiple'
                                                                                  : 'Single'));
                if ($.type(Implementation) !== 'function') {
                    if (Implementations[Implementation]) {
                        Implementation = Implementations[Implementation];
                    } else {
                        throw new Error('Unknown Select3 implementation: ' + Implementation);
                    }
                }

                this.select3 = new Implementation(options);
            }
        }
    });

    return result;
}

/**
 * Select3 Base Constructor.
 *
 * You will never use this constructor directly. Instead, you use $(selector).select3(options) to
 * create an instance of either MultipleSelect3 or SingleSelect3. This class defines all
 * functionality that is common between both.
 *
 * @param options Options object. Accepts the same options as the setOptions method(), in addition
 *                to the following ones:
 *                data - Initial selection data to set. This should be an array of objects with 'id'
 *                       and 'text' properties. This option is mutually exclusive with 'value'.
 *                element - The DOM element to which to attach the Select3 instance. This property
 *                          is set automatically by the $.fn.select3() function.
 *                value - Initial value to set. This should be an array of IDs. This property is
 *                        mutually exclusive with 'data'.
 */
function Select3(options) {

    if (!(this instanceof Select3)) {
        return select3.apply(this, arguments);
    }

    /**
     * jQuery container for the element to which this instance is attached.
     */
    this.$el = $(options.element).on('select3-close', this._closed.bind(this));

    /**
     * Reference to the currently open dropdown.
     */
    this.dropdown = null;

    /**
     * Boolean whether the browser has touch input.
     */
    this.hasTouch = (typeof window !== 'undefined' && 'ontouchstart' in window);

    /**
     * Boolean whether the browser has a physical keyboard attached to it.
     *
     * Given that there is no way for JavaScript to reliably detect this yet, we just assume it's
     * the opposite of hasTouch for now.
     */
    this.hasKeyboard = !this.hasTouch;

    /**
     * Array of items from which to select. If set, this will be an array of objects with 'id' and
     * 'text' properties.
     *
     * If given, all items are expected to be available locally and all selection operations operate
     * on this local array only. If null, items are not available locally, and a query function
     * should be provided to fetch remote data.
     */
    this.items = null;

    /**
     * The function to be used for matching search results.
     */
    this.matcher = Select3.matcher;

    /**
     * Results from a search query.
     */
    this.results = [];

    /**
     * Mapping of templates.
     *
     * Custom templates can be specified in the options object.
     */
    this.templates = $.extend({}, Select3.Templates);

    this.setOptions(options);

    if (options.value) {
        this.value(options.value);
    } else {
        this.data(options.data || null);
    }

    this._events = [];

    this.delegateEvents();
}

/**
 * Methods.
 */
$.extend(Select3.prototype, {

    /**
     * Convenience shortcut for this.$el.find(selector).
     */
    $: function(selector) {

        return this.$el.find(selector);
    },

    /**
     * Closes the dropdown.
     */
    close: function() {

        if (this.dropdown) {
            this.dropdown.close();
        }
    },

    /**
     * Sets or gets the selection data.
     *
     * The selection data contains both IDs and text labels. If you only want to set or get the IDs,
     * you should use the value() method.
     *
     * @param newData Optional new data to set. For a MultipleSelect3 instance the data must be
     *                an array of objects with 'id' and 'text' properties, for a SingleSelect3
     *                instance the data must be a single such object or null to indicate no item is
     *                selected.
     *
     * @return If newData is omitted, this method returns the current data.
     */
    data: function(newData) {

        if ($.type(newData) === 'undefined') {
            return this._data;
        } else {
            newData = this.validateData(newData);

            this._data = newData;
            this._value = this.getValueForData(newData);

            this.triggerChange();
        }
    },

    /**
     * Attaches all listeners from the events map to the instance's element.
     *
     * Normally, you should not have to call this method yourself as it's called automatically in
     * the constructor.
     */
    delegateEvents: function() {

        this.undelegateEvents();

        $.each(this.events, function(event, listener) {
            var selector, index = event.indexOf(' ');
            if (index > -1) {
                selector = event.slice(index + 1);
                event = event.slice(0, index);
            }

            if ($.type(listener) === 'string') {
                listener = this[listener];
            }

            listener = listener.bind(this);

            if (selector) {
                this.$el.on(event, selector, listener);
            } else {
                this.$el.on(event, listener);
            }

            this._events.push({ event: event, selector: selector, listener: listener });
        }.bind(this));
    },

    /**
     * Destroys the Select3 instance.
     */
    destroy: function() {

        this.undelegateEvents();

        var $el = this.$el;
        $el.children().remove();
        $el[0].select3 = null;
        $el = null;
    },

    /**
     * Filters the results to be displayed in the dropdown.
     *
     * The default implementation simply returns the results unfiltered, but the MultiSelect3 class
     * overrides this method to filter out any items that have already been selected.
     *
     * @param results Array of items with 'id' and 'text' properties.
     *
     * @return The filtered array.
     */
    filterResults: function(results) {

        return results;
    },

    /**
     * Returns the correct item for a given ID.
     *
     * @param id The ID to get the item for.
     *
     * @return The corresponding item. Will be an object with 'id' and 'text' properties or null if
     *         the item cannot be found. Note that if no items are defined, this method assumes the
     *         text labels will be equal to the IDs.
     */
    getItemForId: function(id) {

        var items = this.items;
        if (items) {
            return Select3.findById(items, id);
        } else {
            return { id: id, text: '' + id };
        }
    },

    /**
     * Opens the dropdown.
     */
    open: function() {

        if (!this.dropdown) {
            var event = $.Event('select3-opening');
            this.$el.trigger(event);

            if (!event.isDefaultPrevented()) {
                this.dropdown = new Select3.Dropdown({ select3: this });

                this.search('');
            }
        }
    },

    /**
     * (Re-)positions the dropdown.
     */
    positionDropdown: function() {

        if (this.dropdown) {
            this.dropdown.position();
        }
    },

    /**
     * Searches for results based on a search term entered by the user.
     *
     * If an items array has been passed with the options to the Select3 instance, a local search
     * will be performed among those items. Otherwise, the query function specified in the options
     * will be used to perform the search. If neither is defined, nothing happens.
     *
     * @param term The search term the user is searching for.
     */
    search: function(term) {

        if (this.items) {
            term = Select3.transformText(term);
            var matcher = this.matcher;
            this._setResults(this.items.filter(function(item) {
                return matcher(term, item.text);
            }));
        } else if (this.options.query) {
            this.options.query({
                callback: function(response) {
                    if (response && response.results) {
                        if ($.type(response.results) === 'array') {
                            this._setResults(
                                response.results.map(Select3.processItem),
                                { hasMore: !!response.more }
                            );
                        } else {
                            throw new Error('results must be an array');
                        }
                    } else {
                        throw new Error('callback must be passed a response object');
                    }
                }.bind(this),
                offset: 0,
                term: term,
            });
        }
    },

    /**
     * Sets one or more options on this Select3 instance.
     *
     * @param options Options object. May contain one or more of the following properties:
     *                closeOnSelect - Set to false to keep the dropdown open after the user has
     *                                selected an item. This is useful if you want to allow the user
     *                                to quickly select multiple items. The default value is true.
     *                initSelection - Function to map values by ID to selection data. This function
     *                                receives two arguments, 'value' and 'callback'. The value is
     *                                the current value of the selection, which is an ID or an array
     *                                of IDs depending on the input type. The callback should be
     *                                invoked with an object or array of objects, respectively,
     *                                containing 'id' and 'text' properties.
     *                items - Array of items from which to select. Should be an array of objects
     *                        with 'id' and 'text' properties. As convenience, you may also pass an
     *                        array of strings, in which case the same string is used for both the
     *                        'id' and 'text' properties. If items are given, all items are expected
     *                        to be available locally and all selection operations operate on this
     *                        local array only. If null, items are not available locally, and a
     *                        query function should be provided to fetch remote data.
     *                matcher - Function to determine whether text matches a given search term. Note
     *                          this function is only used if you have specified an array of items.
     *                          Receives two arguments:
     *                          term - The search term. Note that for performance reasons, the term
     *                                 has always been already processed using
     *                                 Select3.transformText().
     *                          text - The text that should match the search term.
     *                placeholder - Placeholder text to display when the element has no focus and
     *                              selected items.
     *                query - Function to use for querying items. Receives a single object as
     *                        argument with the following properties:
     *                        callback - Callback to invoke when the results are available. This
     *                                   callback should be passed a single object as argument with
     *                                   the following properties:
     *                                   more - Boolean that can be set to true to indicate there
     *                                          are more results available. Additional results may
     *                                          be fetched by the user through pagination.
     *                                   results - Array of result items. The format for the result
     *                                             items is the same as for passing local items.
     *                        offset - This property is only used for pagination and indicates how
     *                                 many results should be skipped when returning more results.
     *                        term - The search term the user is searching for. Unlike with the
     *                               matcher function, the term has not been processed using
     *                               Select3.transformText().
     *                showDropdown - Set to false if you don't want to use any dropdown (you can
     *                               still open it programmatically using open()).
     *                templates - Object with instance-specific templates to override the global
     *                            templates assigned to Select3.Templates.
     */
    setOptions: function(options) {

        this.options = options;

        $.each(options, function(key, value) {
            switch (key) {
            case 'closeOnSelect':
                if ($.type(value) !== 'boolean') {
                    throw new Error('closeOnSelect must be a boolean');
                }
                break;

            case 'initSelection':
                if ($.type(value) !== 'function') {
                    throw new Error('initSelection must be a function');
                }
                break;

            case 'items':
                if ($.type(value) === 'array') {
                    this.items = value.map(Select3.processItem);
                } else {
                    throw new Error('items must be an array');
                }
                break;

            case 'matcher':
                if ($.type(value) !== 'function') {
                    throw new Error('matcher must be a function');
                }
                this.matcher = value;
                break;

            case 'placeholder':
                if ($.type(value) !== 'string') {
                    throw new Error('placeholder must be a string');
                }
                break;

            case 'query':
                if ($.type(value) !== 'function') {
                    throw new Error('query must be a function');
                }
                break;

            case 'templates':
                this.templates = $.extend({}, this.templates, value);
                break;
            }
        }.bind(this));
    },

    /**
     * Returns the result of the given template.
     *
     * @param templateName Name of the template to process.
     * @param options Options to pass to the template.
     *
     * @return String containing HTML.
     */
    template: function(templateName, options) {

        var template = this.templates[templateName];
        if (template) {
            if ($.type(template) === 'function') {
                return template(options);
            } else if (template.render) {
                return template.render(options);
            } else {
                return template.toString();
            }
        } else {
            throw new Error('Unknown template: ' + templateName);
        }
    },

    /**
     * Triggers the change event.
     *
     * The event object at least contains the following property:
     * val - The new value of the Select3 instance.
     *
     * @param Optional additional options added to the event object.
     */
    triggerChange: function(options) {

        this.triggerEvent('change', $.extend({ val: this._value }, options));
    },

    /**
     * Triggers an event on the instance's element.
     *
     * @param Optional event data to be added to the event object.
     */
    triggerEvent: function(eventName, data) {

        this.$el.trigger($.Event(eventName, data || {}));
    },

    /**
     * Detaches all listeners from the events map from the instance's element.
     *
     * Normally, you should not have to call this method yourself as it's called automatically in
     * the destroy() method.
     */
    undelegateEvents: function() {

        this._events.forEach(function(event) {
            if (event.selector) {
                this.$el.off(event.event, event.selector, event.listener);
            } else {
                this.$el.off(event.event, event.listener);
            }
        }, this);

        this._events = [];
    },

    /**
     * Shorthand for value().
     */
    val: function(newValue) {

        return this.value(newValue);
    },

    /**
     * Validates a single item. Throws an exception if the item is invalid.
     *
     * @param item The item to validate.
     *
     * @return The validated item. May differ from the input item.
     */
    validateItem: function(item) {

        if (item && Select3.isValidId(item.id) && $.type(item.text) === 'string') {
            return item;
        } else {
            throw new Error('Item should have id (number or string) and text (string) properties');
        }
    },

    /**
     * Sets or gets the value of the selection.
     *
     * The value of the selection only concerns the IDs of the selection items. If you are
     * interested in the IDs and the text labels, you should use the data() method.
     *
     * Note that if neither the items option nor the initSelection option have been set, Select3
     * will have no way to determine what text labels should be used with the given IDs in which
     * case it will assume the text is equal to the ID. This is useful if you're working with tags,
     * or selecting e-mail addresses for instance, but may not always be what you want.
     *
     * @param newValue Optional new value to set. For a MultipleSelect3 instance the value must be
     *                 an array of IDs, for a SingleSelect3 instance the value must be a single ID
     *                 (a string or a number) or null to indicate no item is selected.
     *
     * @return If newValue is omitted, this method returns the current value.
     */
    value: function(newValue) {

        if ($.type(newValue) === 'undefined') {
            return this._value;
        } else {
            newValue = this.validateValue(newValue);

            this._value = newValue;

            if (this.options.initSelection) {
                this.options.initSelection(newValue, function(data) {
                    if (this._value === newValue) {
                        this._data = this.validateData(data);

                        this.triggerChange();
                    }
                }.bind(this));
            } else {
                this._data = this.getDataForValue(newValue);

                this.triggerChange();
            }
        }
    },

    /**
     * @private
     */
    _closed: function() {

        this.dropdown = null;
    },

    /**
     * @private
     */
    _getItemId: function(event) {

        // returns the item ID related to an event target.
        // IDs can be either numbers or strings, but attribute values are always strings, so we
        // will have to find out whether the item ID ought to be a number or string ourselves.
        // $.fn.data() is a bit overzealous for our case, because it returns a number whenever the
        // attribute value can be parsed as a number. however, it is possible an item had an ID
        // which is a string but which is parseable as number, in which case we verify if the ID
        // as number is actually found among the data or results. if it isn't, we assume it was
        // supposed to be a string after all...

        var id = $(event.target).closest('[data-item-id]').data('item-id');
        if ($.type(id) === 'string') {
            return id;
        } else {
            if (Select3.findById(this.data, id) || Select3.findById(this.results, id)) {
                return id;
            } else {
                return '' + id;
            }
        }
    },

    /**
     * @private
     */
    _setResults: function(results, options) {

        this.results = results;

        if (this.dropdown) {
            this.dropdown.showResults(this.filterResults(results), options || {});
        }
    }

});

/**
 * Dropdown class to use for displaying dropdowns.
 */
Select3.Dropdown = null;

/**
 * Mapping of implementations.
 */
Select3.Implementations = {};

/**
 * Mapping of keys.
 */
Select3.Keys = {
    BACKSPACE: 8,
    DELETE: 46,
    DOWN_ARROW: 40,
    ENTER: 13,
    ESCAPE: 27,
    LEFT_ARROW: 37,
    RIGHT_ARROW: 39,
    UP_ARROW: 38
};

/**
 * Mapping with templates to use for rendering select boxes and dropdowns. See select3-templates.js
 * for a useful set of default templates, as well as for documentation of the individual templates.
 */
Select3.Templates = {};

/**
 * Finds an item in the given array with the specified ID.
 *
 * @param array Array to search in.
 * @param id ID to search for.
 *
 * @return The item in the array with the given ID, or null if the item was not found.
 */
Select3.findById = function(array, id) {

    var index = Select3.findIndexById(array, id);
    return (index > -1 ? array[index] : null);
};

/**
 * Finds the index of an item in the given array with the specified ID.
 *
 * @param array Array to search in.
 * @param id ID to search for.
 *
 * @return The index of the item in the array with the given ID, or -1 if the item was not found.
 */
Select3.findIndexById = function(array, id) {

    for (var i = 0, length = array.length; i < length; i++) {
        if (array[i].id === id) {
            return i;
        }
    }
    return -1;
};

/**
 * Checks whether a value can be used as a valid ID for selection items. Only numbers and strings
 * are accepted to be used as IDs.
 *
 * @param id The value to check whether it is a valid ID.
 *
 * @return true if the value is a valid ID, false otherwise.
 */
Select3.isValidId = function(id) {

    var type = $.type(id);
    return type === 'number' || type === 'string';
};

/**
 * Decides whether a given text string matches a search term. The default implementation simply
 * checks whether the term is contained within the text, after transforming them using
 * transformText().
 *
 * @param term The search term. Note that for performance reasons, the term has always been already
 *             processed using transformText().
 * @param text The text that should match the search term.
 *
 * @return true if the text matches the term, false otherwise.
 */
Select3.matcher = function(term, text) {

    return Select3.transformText(text).indexOf(term) > -1;
};

/**
 * Helper function for processing items.
 *
 * @param item The item to process, either as object containing 'id' and 'text' properties or just
 *             as ID.
 *
 * @return Object containing 'id' and 'text' properties.
 */
Select3.processItem = function(item) {

    if (Select3.isValidId(item)) {
        return { id: item, text: '' + item };
    } else if (item && Select3.isValidId(item.id)) {
        return item;
    } else {
        throw new Error('invalid item');
    }
};

/**
 * Quotes a string so it can be used in a CSS attribute selector. It adds double quotes to the
 * string and escapes all occurrences of the quote character inside the string.
 *
 * @param string The string to quote.
 *
 * @return The quoted string.
 */
Select3.quoteCssAttr = function(string) {

    return '"' + ('' + string).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
};

/**
 * Transforms text in order to find matches. The default implementation casts all strings to
 * lower-case so that any matches found will be case-insensitive.
 *
 * @param string The string to transform.
 *
 * @return The transformed string.
 */
Select3.transformText = function(string) {

    return string.toLowerCase();
};

$.fn.select3 = Select3;

module.exports = Select3;
