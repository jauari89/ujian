<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $credentials = $request->validate([
            'nrp' => ['required', 'string', 'max:255', 'regex:/^(\d{10}|[^@\s]+@[^@\s]+\.[^@\s]+)$/'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('nrp', $credentials['nrp'])
            ->orWhere('email', $credentials['nrp'])
            ->first();

        if (! $user || ! Hash::check($credentials['password'], $user->password)) {
            throw ValidationException::withMessages([
                'nrp' => ['NRP/email atau password salah.'],
            ]);
        }

        Auth::login($user);
        if ($request->hasSession()) {
            $request->session()->regenerate();
        }

        if (! $user->first_login_at) {
            $user->forceFill(['first_login_at' => now()])->save();
        }

        return response()->json(['user' => $user]);
    }

    public function logout(Request $request)
    {
        Auth::guard('web')->logout();
        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->noContent();
    }

    public function me(Request $request)
    {
        return response()->json(['user' => $request->user()]);
    }
}
