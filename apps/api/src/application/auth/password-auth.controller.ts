import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from "./password-auth.dto.js";
import { PasswordAuthService } from "./password-auth.service.js";

@Controller("auth/password")
export class PasswordAuthController {
  constructor(private readonly passwordAuth: PasswordAuthService) {}

  @Get("departments")
  listDepartments() {
    return this.passwordAuth.listActiveDepartments();
  }

  @Post("register")
  register(@Body() body: RegisterDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.passwordAuth.register(body, request, response);
  }

  @Post("login")
  login(@Body() body: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.passwordAuth.login(body, request, response);
  }

  @Post("forgot-password")
  forgotPassword(@Body() body: ForgotPasswordDto, @Req() request: Request) {
    return this.passwordAuth.forgotPassword(body, request);
  }

  @Post("reset-password")
  resetPassword(@Body() body: ResetPasswordDto, @Req() request: Request) {
    return this.passwordAuth.resetPassword(body, request);
  }
}
