var Backbone   = require('backbone'),
    Attachment = require('./attachment'),
    _          = require('underscore')._,
    http       = require('http'),
    https      = require('https'),
    fs         = require('fs');

var ALWAYS_ADD_LABELS = ['new'];
var DEFAULT_TYPE      = 'feature'

// borrowed from Prototype.js
function escapeHTML(html) {
  return new String(html).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var Story = module.exports = Backbone.Model.extend({

  // attributes:
  // id -- set by save()
  // projectId
  // token
  // from
  // subject
  // body
  // type - inferred from subject
  // labels - auto extracted from subject if empty
  // attachments
  
  initialize: function(attributes) {
    this.setTypeFromSubject();
    this.setLabelsFromSubject();
    _.bindAll(this, 'saveCallback', 'createAttachments', 'createAttachmentFromFile');
  },

  setTypeFromSubject: function() {
    if(new String(this.get('subject')).match(/bug/i)) {
      this.set({type: 'bug'});
    } else {
      this.set({type: DEFAULT_TYPE});
    }
  },

  setLabelsFromSubject: function() {
    if(this.get('labels')) return;
    var labels = [];
    var re = /\[[^\]]+\]/g;
    var match;
    while(match = re.exec(this.get('subject'))) {
      labels = labels.concat(match[0].replace(/\[|\]/g, '').split(/\s*,\s*/));
    }
    labels = labels.concat(ALWAYS_ADD_LABELS);
    var subject = new String(this.get('subject')).replace(re, '').replace(/^\s+|\s+$/, '');
    this.set({labels: labels, subject: subject});
  },
  
  fromName: function() {
    return new String(this.get('from')).replace(/\s*<.*>/, '');
  },
  
  toXml: function() {
    return '<story><name>' + escapeHTML(this.get('subject')) + '</name>' +
           '<story_type>' + escapeHTML(this.get('type')) + '</story_type>' +
           '<requested_by>' + escapeHTML(this.fromName()) + '</requested_by>' +
           '<labels>' + escapeHTML(this.get('labels').join(', ')) + '</labels>' +
           '<description>' + escapeHTML(this.get('body')) + '</description></story>';
  },

  save: function() {
    var storyXml = this.toXml();
    
    var req = https.request({
      host:   'www.pivotaltracker.com',
      port:   443,
      method: 'POST',
      path:   '/services/v3/projects/' + this.get('projectId') + '/stories',
      headers: {
        'X-TrackerToken': this.get('token'),
        'Content-Type':   'application/xml',
        'Content-Length': storyXml.length
      }
    }, this.saveCallback);
    
    req.on('error', _.bind(this.trigger, this, 'error'));

    req.write(storyXml);
    req.end();
  },

  saveCallback: function(res) {
    res.setEncoding('utf8');
    var body = '';

    res.on('data', function(chunk) {
      body += chunk;
    });

    res.on('end', _.bind(function() {
      try {
        var storyId = body.match(/<id.*?>(\d+)<\/id>/m)[1];
        var storyUrl = body.match(/<url>([^<]+)<\/url>/m)[1];
        this.set({id: storyId});
        if(this.get('attachments').length > 0) {
          this.createAttachments(_.bind(this.trigger, this, 'done', storyUrl));
        } else {
          this.trigger('done', storyUrl)
        }
      } catch(e) {
        console.log('PT Response Body: ' + body);
        this.trigger('error', new String(e) + "\n\n" + body);
      }
    }, this));
  },

  createAttachments: function(cb) {
    var count = this.get('attachments').length;
    _.each(this.get('attachments'), function(file) {
      fs.readFile(file.path, null, _.bind(function(err, data) {
        if(err) this.trigger('error', err);
        this.createAttachmentFromFile(file, data, _.bind(function() {
          count--;
          if(count == 0) cb();
        }, this));
      }, this));
    }, this)
  },

  createAttachmentFromFile: function(file, data, cb) {
    var attachment = new Attachment({
      projectId: this.get('projectId'),
      storyId:   this.get('id'),
      token:     this.get('token'),
      file:      file,
      data:      data
    });
    attachment.bind('error', _.bind(this.trigger, this, 'error'));
    attachment.bind('done', cb);
    attachment.save();
  }
});
