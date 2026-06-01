<!doctype html>
<html lang="id">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Smart Exam</title>
        @unless (app()->environment('testing'))
            @vite(['resources/css/app.css', 'resources/js/app.jsx'])
        @endunless
    </head>
    <body>
        <div id="root"></div>
    </body>
</html>
