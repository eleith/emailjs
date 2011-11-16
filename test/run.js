var prompt  = require('prompt');
var os      = require('os');
var path    = require('path');
var tests   = require('./tests');
var email   = require('../email');

var run =
{
   tests: function(config)
   {
      var server = email.server.connect(
      {
         user:			config.username, 
         password:	config.password, 
         host:			config.host, 
         port:			config.port, 
         tls:			config.type == 'tls',
         ssl:			config.type == 'ssl'
      });

      for(var test in tests)
      {
         tests[test](email, server, config);
      }
   },

   prompts: function(config)
   {
      var prompts = 
      {
         host:
         {
            name:       'host',
            message:    'smtp hostname or IP',
            'default':   'localhost'
         },
      
         type: 
         {
            name:       'type',
            message:    'ssl, tls or none',
            validator:  /^(ssl|tls|none)$/,
            warning:    "connection type must be 'ssl', 'tls', 'none'",
            'default':   'tls'
         },
      
         username:
         {
            name:       'username',
            message:    "smtp username",
            'default':   ''
         },
      
         password:
         {
            name:       'password',
            message:    "smtp password",
            hidden:     true,
            'default':   ''
         }
      };

      var ask = [];
      
      for(var each in prompts)
      {
         if(!config[each])
            ask.push(prompts[each]);
      }
      
      if(ask.length)
      {
         prompt.start();
         prompt.message = "";
         prompt.delimiter = ">";
         prompt.addProperties(config, ask, function(err) { run.prompts2(config); });
      }
      else
         run.prompts2(config);
   },

   prompts2: function(config)
   {
      var ask = [];

      if(!config.port)
      {
         ask.push(
         {
            name:       'port',
            message:    'smtp port',
            'default':  config.type == 'tls' ? 587 : config.type == 'ssl' ? 465 : 25
         });
      }

      if(!config.email)
      {
         ask.push(
         {
            name:       'email',
            message:    'your email address',
            empty:      false,
            validator:  /.+@.+/,
            warning:    'not a valid email address'
         });
      }
   
      if(ask.length)
      {
         if(!prompt.started)
            prompt.start();

         prompt.message = "";
         prompt.delimiter = ">";
         prompt.addProperties(config, ask, function(err) { run.tests(config); });
      }
      else
         run.tests(config);
   }
};

path.exists(path.join(__dirname, 'config.js'), function(exists)
{
   var config = {};

   if(exists)
      config = require(path.join(__dirname, 'config.js'));

   run.prompts(config);
});
