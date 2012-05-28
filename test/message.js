describe("messages", function()
{
   var simplesmtp = require("simplesmtp");
   var expect     = require("chai").expect;
   var fs         = require("fs");
   var os         = require("os");
   var path       = require('path');
   var email      = require('../email');
   var port       = 2526;
   var server     = null;
   var smtp       = null;

   var send = function(message, verify)
   {
      smtp.on("startData", function(envelope)
      {
         envelope.parser = new (require("mailparser").MailParser)({defaultCharset:"utf-8"});
         envelope.parser.on("end", function(mail)
         {
            verify(mail);
            smtp.removeListener("startData", arguments.callee);
         });
      });

      server.send(message, function(err) 
      {
         if(err)
            throw err;
      });
   };

   before(function(done)
   {
      smtp = simplesmtp.createServer();

      smtp.listen(port, function()
      {
         server = email.server.connect({port:port});

         smtp.on("data", function(envelope, chunk)
         {
            envelope.parser.write(chunk);
         });
         
         smtp.on("dataReady", function(envelope, callback)
         {
            envelope.parser.end();
            callback(null);
         });

         done();
      });
   });

   after(function(done)
   {
      smtp.end(done);
   });

   it("simple text message", function(done)
   {
      var message =
      {
         subject: "this is a test TEXT message from emailjs",
         from:    "zelda@gmail.com",
         to:      "gannon@gmail.com",
         text:    "hello friend, i hope this message finds you well."
      };

      send(email.message.create(message), function(mail)
      {
         expect(mail.text).to.equal(message.text + "\n\n");
         expect(mail.headers.subject).to.equal(message.subject);
         expect(mail.headers.from).to.equal(message.from);
         expect(mail.headers.to).to.equal(message.to);
         done();
      });
   });

   it("html data", function(done) 
   {
      var html = fs.readFileSync(path.join(__dirname, "attachments/smtp.html"), "utf-8");
      var message =
      {
         subject:    "this is a test TEXT+HTML+DATA message from emailjs",
         from:       "obama@gmail.com",
         to:         "mitt@gmail.com",
         text:       "hello friend if you are seeing this, you can not view html emails. it is attached inline.",
         attachment: {data:html, alternative:true}
      };

      send(message, function(mail)
      {
         expect(mail.html).to.equal(html);
         expect(mail.text).to.equal(message.text + "\n");
         expect(mail.headers.subject).to.equal(message.subject);
         expect(mail.headers.from).to.equal(message.from);
         expect(mail.headers.to).to.equal(message.to);
         done();
      });
   });

   it("html file", function(done)
   {
      var html    = fs.readFileSync(path.join(__dirname, "attachments/smtp.html"), "utf-8");
      var headers =
      {
         subject: "this is a test TEXT+HTML+FILE message from emailjs",
         from:    "thomas@gmail.com",
         to:      "nikolas@gmail.com",
         text:    "hello friend if you are seeing this, you can not view html emails. it is attached inline.",
         attachment: {path:path.join(__dirname, "attachments/smtp.html"), alternative:true}
      };

      send(headers, function(mail)
      {
         expect(mail.html).to.equal(html);
         expect(mail.text).to.equal(headers.text + "\n");
         expect(mail.headers.subject).to.equal(headers.subject);
         expect(mail.headers.from).to.equal(headers.from);
         expect(mail.headers.to).to.equal(headers.to);
         done();
      });
   });

   it("html with image embed", function(done)
   {
      var html    = fs.readFileSync(path.join(__dirname, "attachments/smtp2.html"), "utf-8");
      var image   = fs.readFileSync(path.join(__dirname, "attachments/smtp.gif"));
      var headers =
      {
         subject: "this is a test TEXT+HTML+IMAGE message from emailjs",
         from:    "ninja@gmail.com",
         to:      "pirate@gmail.com",
         text:    "hello friend if you are seeing this, you can not view html emails. it is attached inline.",
         attachment:
         {
            path:          path.join(__dirname, "attachments/smtp2.html"), 
            alternative:   true,
            related: 
            [
               {
                  path:    path.join(__dirname, "attachments/smtp.gif"),
                  type:    "image/gif", 
                  name:    "smtp-diagram.gif", 
                  headers: {"Content-ID":"<smtp-diagram@local>"}
               }
            ]
         }
      };

      send(headers, function(mail)
      {
         expect(mail.attachments[0].content.toString("base64")).to.equal(image.toString("base64"));
         expect(mail.html).to.equal(html);
         expect(mail.text).to.equal(headers.text + "\n");
         expect(mail.headers.subject).to.equal(headers.subject);
         expect(mail.headers.from).to.equal(headers.from);
         expect(mail.headers.to).to.equal(headers.to);
         done();
      });
   });

   it("attachment", function(done)
   {
      var pdf     = fs.readFileSync(path.join(__dirname, "attachments/smtp.pdf"));
      var headers = 
      {
         subject: "this is a test TEXT+ATTACHMENT message from emailjs",
         from:    "washing@gmail.com",
         to:      "lincoln@gmail.com",
         text:    "hello friend, i hope this message and pdf finds you well.",
         attachment:{path:path.join(__dirname, "attachments/smtp.pdf"), type:"application/pdf", name:"smtp-info.pdf"}
      };

      send(headers, function(mail)
      {
         expect(mail.attachments[0].content.toString("base64")).to.equal(pdf.toString("base64"));
         expect(mail.text).to.equal(headers.text + "\n");
         expect(mail.headers.subject).to.equal(headers.subject);
         expect(mail.headers.from).to.equal(headers.from);
         expect(mail.headers.to).to.equal(headers.to);
         done();
      });
   });

   it("attachments", function(done)
   {
      var pdf     = fs.readFileSync(path.join(__dirname, "attachments/smtp.pdf"));
      var tar     = fs.readFileSync(path.join(__dirname, "attachments/postfix-2.8.7.tar.gz"));
      var headers =
      {
         subject: "this is a test TEXT+2+ATTACHMENTS message from emailjs",
         from:    "sergey@gmail.com",
         to:      "jobs@gmail.com", 
         text:    "hello friend, i hope this message and attachments finds you well.",
         attachment:
         [
            {path:path.join(__dirname, "attachments/smtp.pdf"), type:"application/pdf", name:"smtp-info.pdf"},
            {path:path.join(__dirname, "attachments/postfix-2.8.7.tar.gz"), type:"application/tar-gz", name:"postfix.source.2.8.7.tar.gz"}
         ]
      };

      send(headers, function(mail)
      {
         expect(mail.attachments[0].content.toString("base64")).to.equal(pdf.toString("base64"));
         expect(mail.attachments[1].content.toString("base64")).to.equal(tar.toString("base64"));
         expect(mail.text).to.equal(headers.text + "\n");
         expect(mail.headers.subject).to.equal(headers.subject);
         expect(mail.headers.from).to.equal(headers.from);
         expect(mail.headers.to).to.equal(headers.to);
         done();
      });
   });

   it("streams", function(done)
   {
      var pdf     = fs.readFileSync(path.join(__dirname, "attachments/smtp.pdf"));
      var tar     = fs.readFileSync(path.join(__dirname, "attachments/postfix-2.8.7.tar.gz"));
      var stream  = fs.createReadStream(path.join(__dirname, "attachments/smtp.pdf"));
      var stream2 = fs.createReadStream(path.join(__dirname, "attachments/postfix-2.8.7.tar.gz"));
      var headers =
      {
         subject: "this is a test TEXT+2+STREAMED+ATTACHMENTS message from emailjs",
         from:    "stanford@gmail.com",
         to:      "mit@gmail.com", 
         text:    "hello friend, i hope this message and streamed attachments finds you well.",
         attachment:
         [
            {stream:stream, type:"application/pdf", name:"smtp-info.pdf"},
            {stream:stream2, type:"application/x-gzip", name:"postfix.source.2.8.7.tar.gz"}
         ]
      };

      stream.pause();
      stream2.pause();

      send(headers, function(mail)
      {
         expect(mail.attachments[0].content.toString("base64")).to.equal(pdf.toString("base64"));
         expect(mail.attachments[1].content.toString("base64")).to.equal(tar.toString("base64"));
         expect(mail.text).to.equal(headers.text + "\n");
         expect(mail.headers.subject).to.equal(headers.subject);
         expect(mail.headers.from).to.equal(headers.from);
         expect(mail.headers.to).to.equal(headers.to);
         done();
      });
   });
});
